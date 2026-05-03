import { describe, expect, it } from 'vitest';
import { extractJsonObject } from '@/lib/agent/parse';

describe('extractJsonObject', () => {
  it('parses a clean JSON object', () => {
    expect(extractJsonObject('{"a":1,"b":[2,3]}')).toEqual({ a: 1, b: [2, 3] });
  });

  it('parses with surrounding whitespace', () => {
    expect(extractJsonObject('   \n{"a":1}\n  ')).toEqual({ a: 1 });
  });

  it('extracts the first balanced object after preamble prose', () => {
    const text = 'Here are my picks:\n{"recommendations":[{"rating_key":"1"}]}';
    expect(extractJsonObject(text)).toEqual({
      recommendations: [{ rating_key: '1' }],
    });
  });

  it('extracts JSON wrapped in markdown code fence', () => {
    const text = '```json\n{"x":42}\n```';
    expect(extractJsonObject(text)).toEqual({ x: 42 });
  });

  it('handles nested braces correctly', () => {
    const text = 'sure: {"outer":{"inner":{"deep":[1,2]}}}';
    expect(extractJsonObject(text)).toEqual({
      outer: { inner: { deep: [1, 2] } },
    });
  });

  it('ignores braces inside string values', () => {
    const text = 'reply: {"reasoning":"a {trick} statement","ok":true}';
    expect(extractJsonObject(text)).toEqual({
      reasoning: 'a {trick} statement',
      ok: true,
    });
  });

  it('handles escaped quotes inside strings', () => {
    const text = 'output: {"reasoning":"she said \\"hi\\" then left"}';
    expect(extractJsonObject(text)).toEqual({
      reasoning: 'she said "hi" then left',
    });
  });

  it('throws when no object is present', () => {
    expect(() => extractJsonObject('just prose, no json')).toThrow(/no JSON object/);
  });

  it('throws when an object is unbalanced', () => {
    expect(() => extractJsonObject('{"a": 1, "b": [2, 3]')).toThrow(
      /unbalanced/,
    );
  });

  it('extracts only the first balanced object when multiple are present', () => {
    const text = '{"a":1} ignored {"b":2}';
    expect(extractJsonObject(text)).toEqual({ a: 1 });
  });
});
