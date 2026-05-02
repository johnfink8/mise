/**
 * Extract the first balanced JSON object from a free-form string.
 *
 * The model usually replies with `{...}` directly, but sometimes wraps it in
 * markdown fences or chats around it. This walks character-by-character to find
 * the first balanced `{...}` block, ignoring braces that appear inside strings.
 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  // Fast path: whole string parses.
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to scan
  }
  const start = trimmed.indexOf('{');
  if (start < 0) throw new Error('no JSON object in agent response');
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inStr) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(trimmed.slice(start, i + 1));
    }
  }
  throw new Error('unbalanced JSON object in agent response');
}
