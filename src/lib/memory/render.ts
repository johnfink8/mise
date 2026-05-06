import { listMemories } from './store';

/**
 * Render the user-memory block to prepend to a cycle's user message. Returns
 * '' when there are no memories. Memories are framed as soft taste context,
 * not rules — see prompts/memory-generator.md and the system prompt for the
 * mirroring framing.
 */
export async function renderMemoriesBlock(): Promise<string> {
  const mems = await listMemories();
  if (mems.length === 0) return '';
  const lines = mems
    .slice()
    .reverse() // oldest first reads more naturally
    .map((m) => `- ${m.text}`);
  return [
    'Long-term taste notes from previous sessions (soft context, not rules — let',
    'them nudge picks where relevant, ignore where they conflict with the current',
    'request):',
    ...lines,
  ].join('\n');
}
