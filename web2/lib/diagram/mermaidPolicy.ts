export interface MermaidPolicyResult {
  ok: boolean;
  error?: string;
}

const UNSAFE_PATTERNS: Array<[RegExp, string]> = [
  [/^\s*---(?:\r?\n|$)/, 'YAML frontmatter is not allowed'],
  [/%%\s*\{[\s\S]*?\}\s*%%/i, 'Mermaid init/config directives are not allowed'],
  [/^\s*click\s+/im, 'Mermaid links and callbacks are not allowed'],
  [/javascript\s*:/i, 'JavaScript URLs are not allowed'],
  [/<\s*\/?\s*[a-z][^>]*>/i, 'Raw HTML is not allowed in diagrams'],
  [/\b(?:img|image|icon)\s*:\s*(?:https?:|data:|\/\/)/i, 'External diagram content is not allowed'],
  [/\b(?:href|link)\s*=\s*["']?(?:https?:|\/\/)/i, 'External diagram links are not allowed'],
  [/\0/, 'Null bytes are not allowed'],
];

/**
 * Mermaid interprets backticks inside a quoted label as its Markdown-string delimiter. Agents
 * commonly use Markdown inline-code around paths, which becomes invalid when more label content
 * (notably <br/>) follows the closing backtick. Strip only those delimiters inside complete quoted
 * strings; the visible text, Mermaid structure, evidence comments, and backticks outside labels
 * remain unchanged.
 */
export function normalizeMermaidSource(source: string): string {
  return source.replace(/"(?:\\.|[^"\\])*"/g, (quoted) => quoted.replaceAll('`', ''));
}

export function validateMermaidSource(source: string, maxBytes = 100_000): MermaidPolicyResult {
  if (!source.trim()) return { ok: false, error: 'The Mermaid block is empty.' };
  if (new TextEncoder().encode(source).byteLength > maxBytes) {
    return { ok: false, error: `The Mermaid block exceeds the ${maxBytes.toLocaleString()} byte limit.` };
  }
  // Mermaid uses an attribute-free <br> as diagram syntax for multiline labels. Keep that
  // narrowly-scoped exception while treating every other HTML-looking tag as active content.
  const sourceWithoutLineBreaks = source.replaceAll(/<br\s*\/?\s*>/gi, '');
  for (const [pattern, error] of UNSAFE_PATTERNS) {
    if (pattern.test(sourceWithoutLineBreaks)) return { ok: false, error };
  }
  return { ok: true };
}
