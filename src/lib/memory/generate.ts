import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Agent } from '@mastra/core/agent';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import type { RecommendationOutputT } from '@/lib/agent/output';
import { extractJsonObject } from '@/lib/agent/parse';
import { logger } from '@/lib/logger';
import { listMemories } from './store';

const MEMORY_MODEL = 'claude-haiku-4-5';

let cachedAgent: Agent | null = null;
let cachedInstructions: string | null = null;

async function loadInstructions(): Promise<string> {
  if (cachedInstructions) return cachedInstructions;
  cachedInstructions = (
    await readFile(path.join(process.cwd(), 'prompts', 'memory-generator.md'), 'utf8')
  ).trim();
  return cachedInstructions;
}

async function getMemoryAgent(): Promise<Agent> {
  if (cachedAgent) return cachedAgent;
  const instructions = await loadInstructions();
  cachedAgent = new Agent({
    id: 'mise-memory',
    name: 'mise-memory',
    instructions,
    model: anthropic(MEMORY_MODEL),
  });
  return cachedAgent;
}

interface RecommendationLite {
  title: string;
  year: number | null;
  group: string | null;
  reasoning: string;
}

export interface GenerateMemoryArgs {
  prompts: string[]; // full history of user prompts (cycle 0..N)
  latestCycle: number;
  picks: RecommendationLite[]; // titles+reasonings from the cycle that just finished
  playlistSummary?: string | null;
  followUpSuggestion?: string | null;
}

/**
 * Build the compact transcript we hand the memory model. Tool returns are
 * deliberately omitted — they are huge (hundreds of catalog rows) and rarely
 * carry the user's taste signal. What matters: the user's words across the
 * conversation and a thumbnail of what was actually recommended at the moment
 * the latest follow-up landed, so the model can read the follow-up *in
 * context* of what it's reacting to.
 */
function buildContextBlock(args: GenerateMemoryArgs): string {
  const lines: string[] = [];

  lines.push('## Conversation');
  args.prompts.forEach((p, i) => {
    const tag = i === args.latestCycle ? ' (LATEST — react to this)' : '';
    lines.push(`prompt ${i}${tag}: ${p}`);
  });

  if (args.picks.length > 0) {
    lines.push('');
    lines.push("## What mise just recommended (the picks the user is reacting to)");
    for (const p of args.picks) {
      const yearPart = p.year ? ` (${p.year})` : '';
      const groupPart = p.group ? ` [${p.group}]` : '';
      // Keep reasonings — they are short and reveal the angle each pick was made on.
      lines.push(`- ${p.title}${yearPart}${groupPart} — ${p.reasoning}`);
    }
    if (args.playlistSummary) {
      lines.push('');
      lines.push(`Playlist summary: ${args.playlistSummary}`);
    }
  }

  return lines.join('\n');
}

interface MemoryParse {
  memory: string | null;
}

const MemoryShape = z.object({
  memory: z.string().nullable().optional(),
});

function parseMemory(text: string): MemoryParse {
  let raw: unknown;
  try {
    raw = extractJsonObject(text);
  } catch {
    return { memory: null };
  }
  const parsed = MemoryShape.safeParse(raw);
  if (!parsed.success) return { memory: null };
  const trimmed = parsed.data.memory?.trim();
  if (!trimmed) return { memory: null };
  // Defensive cap so a runaway model can't dump a paragraph.
  return { memory: trimmed.slice(0, 280) };
}

/**
 * Look at the cycle that just finished and decide whether to record a new
 * long-term memory. Returns the memory string or null. Errors are logged and
 * swallowed — memory is best-effort, never blocks the user.
 */
export async function generateMemory(args: GenerateMemoryArgs): Promise<string | null> {
  try {
    const existing = await listMemories();
    const existingBlock = existing.length
      ? `## Existing memories (do NOT re-emit anything substantively duplicated here)\n${existing
          .map((m) => `- ${m.text}`)
          .join('\n')}`
      : '## Existing memories\n(none yet)';

    const userMessage = [existingBlock, '', buildContextBlock(args)].join('\n');

    const agent = await getMemoryAgent();
    const result = await agent.generate([{ role: 'user', content: userMessage }]);
    const { memory } = parseMemory(result.text ?? '');
    if (!memory) return null;

    // Drop near-duplicates against existing memories (case-insensitive substring match).
    const norm = memory.toLowerCase();
    for (const e of existing) {
      const en = e.text.toLowerCase();
      if (en === norm || en.includes(norm) || norm.includes(en)) return null;
    }

    return memory;
  } catch (err) {
    logger.warn({ err }, 'memory generation failed');
    return null;
  }
}

export const _internal = { buildContextBlock, parseMemory };
