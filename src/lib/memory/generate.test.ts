import { describe, it, expect } from 'vitest';
import { _internal } from './generate';

const { buildContextBlock, parseMemory } = _internal;

describe('buildContextBlock', () => {
  it('omits tool returns and surfaces the latest prompt distinctly', () => {
    const text = buildContextBlock({
      prompts: ['something funny', 'should have included idiocracy'],
      latestCycle: 1,
      picks: [
        {
          title: 'Office Space',
          year: 1999,
          group: 'workplace satire',
          reasoning: 'classic cubicle comedy',
        },
      ],
      playlistSummary: 'goofy 90s comedies',
    });
    expect(text).toContain('LATEST');
    expect(text).toContain('idiocracy');
    expect(text).toContain('Office Space (1999) [workplace satire]');
    expect(text).toContain('goofy 90s comedies');
  });

  it('handles empty picks and missing playlist summary', () => {
    const text = buildContextBlock({
      prompts: ['hi'],
      latestCycle: 0,
      picks: [],
    });
    expect(text).toContain('prompt 0');
    expect(text).not.toContain('What mise just recommended');
  });
});

describe('parseMemory', () => {
  it('extracts a string memory', () => {
    expect(parseMemory('{"memory":"likes heists"}')).toEqual({ memory: 'likes heists' });
  });

  it('returns null for {memory: null}', () => {
    expect(parseMemory('{"memory":null}')).toEqual({ memory: null });
  });

  it('returns null for malformed JSON', () => {
    expect(parseMemory('lol nope')).toEqual({ memory: null });
  });

  it('returns null for empty string memory', () => {
    expect(parseMemory('{"memory":"   "}')).toEqual({ memory: null });
  });

  it('caps very long memories defensively', () => {
    const big = 'x'.repeat(500);
    const result = parseMemory(JSON.stringify({ memory: big }));
    expect(result.memory?.length).toBe(280);
  });

  it('tolerates surrounding noise around JSON', () => {
    expect(parseMemory('here you go: {"memory":"likes A24"}\n\nthanks')).toEqual({
      memory: 'likes A24',
    });
  });
});
