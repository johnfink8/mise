import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Agent } from '@mastra/core/agent';
import { anthropic } from '@ai-sdk/anthropic';
import { tools } from './tools';

export const DEFAULT_MODEL = 'claude-sonnet-4-6';

export async function loadSystemPrompt(): Promise<string> {
  return (
    await readFile(path.join(process.cwd(), 'prompts', 'system.md'), 'utf8')
  ).trim();
}

/**
 * The Agent is constructed without `instructions`. We pass the system prompt
 * as the first message in `agent.generate()` so we can attach Anthropic
 * cache-control metadata to it (see runAgentCycle). Caching the system
 * message also implicitly caches the tool definitions that precede it in the
 * Anthropic API request, which is the bulk of our prompt size.
 */
export async function getAgent(model: string = DEFAULT_MODEL): Promise<Agent> {
  return new Agent({
    id: 'mise',
    name: 'mise',
    instructions: '',
    model: anthropic(model),
    tools,
  });
}

export { tools };
export { RecommendationOutput, type RecommendationOutputT } from './output';
export { validateRecommendations } from './validate';
