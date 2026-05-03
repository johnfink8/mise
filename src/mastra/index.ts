import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import { anthropic } from '@ai-sdk/anthropic';
import { tools } from '@/lib/agent/tools';
import { DEFAULT_MODEL } from '@/lib/agent';

// `mastra dev` bundles this file to .mastra/output/, where process.cwd()
// resolves under src/mastra/public/. Anchor to the source/bundle's own
// directory and walk up to the project root instead — works in both contexts
// (../../prompts from src/mastra/ and from .mastra/output/ both land at
// <project root>/prompts).
const SYSTEM_PROMPT_PATH = path.resolve(import.meta.dirname, '../../prompts/system.md');

/**
 * Mastra dev-playground entrypoint. Discovered by `mastra dev` (and friends),
 * which spins up a UI at http://localhost:4111 where you can chat with the
 * agent, inspect tool calls, see traces, and test prompts in isolation.
 *
 * The playground constructs its own Agent — synchronously, with a system
 * prompt loaded at module init — instead of going through getAgent() in
 * /src/lib/agent. The runtime app uses runAgentCycle which attaches an
 * Anthropic cache breakpoint to the system message; the playground forgoes
 * that since the SDK uses Mastra's `instructions` field directly.
 */
const instructions = readFileSync(SYSTEM_PROMPT_PATH, 'utf8').trim();

const mise = new Agent({
  id: 'mise',
  name: 'mise',
  instructions,
  model: anthropic(DEFAULT_MODEL),
  tools,
});

export const mastra = new Mastra({
  agents: { mise },
});
