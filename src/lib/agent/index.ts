import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Agent } from '@mastra/core/agent';
import { anthropic } from '@ai-sdk/anthropic';
import { tools } from './tools';

export const DEFAULT_MODEL = 'claude-sonnet-4-5';

export const LOOP_LIMITS = {
  maxSteps: 16,
} as const;

async function loadSystemPrompt(): Promise<string> {
  return (
    await readFile(path.join(process.cwd(), 'prompts', 'system.md'), 'utf8')
  ).trim();
}

export async function getAgent(model: string = DEFAULT_MODEL): Promise<Agent> {
  const instructions = await loadSystemPrompt();
  return new Agent({
    name: 'mise',
    instructions,
    model: anthropic(model),
    tools,
  });
}

export { tools };
export { RecommendationOutput, type RecommendationOutputT } from './output';
export { validateRecommendations, loadNudge } from './validate';
