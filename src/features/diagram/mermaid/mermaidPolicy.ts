export interface MermaidPolicyResult {
  ok: boolean;
  error?: string;
}

const UNSAFE_PATTERNS: Array<[RegExp, string]> = [
  [/^\s*---(?:\r?\n|$)/, 'YAML frontmatter is not allowed'],
  [/%%\s*\{[\s\S]*?\}\s*%%/i, 'Mermaid init/config directives are not allowed'],
  [/^\s*click\s+/im, 'Mermaid links and callbacks are not allowed'],
  [/javascript\s*:/i, 'JavaScript URLs are not allowed'],
  [/\b(?:img|image|icon)\s*:\s*(?:https?:|data:|\/\/)/i, 'External diagram content is not allowed'],
  [/\b(?:href|link)\s*=\s*["']?(?:https?:|\/\/)/i, 'External diagram links are not allowed'],
  [/\0/, 'Null bytes are not allowed'],
];

// Every HTML, SVG, and MathML element name (current and obsolete). A tag-like token using one of
// these names is treated as raw HTML even without attributes; anything with attributes or a
// self-closing slash is rejected regardless of name.
const KNOWN_ELEMENT_NAMES = new Set([
  'a', 'abbr', 'acronym', 'address', 'applet', 'area', 'article', 'aside', 'audio', 'b', 'base',
  'basefont', 'bdi', 'bdo', 'big', 'blink', 'blockquote', 'body', 'br', 'button', 'canvas',
  'caption', 'center', 'cite', 'code', 'col', 'colgroup', 'data', 'datalist', 'dd', 'del',
  'details', 'dfn', 'dialog', 'dir', 'div', 'dl', 'dt', 'em', 'embed', 'fencedframe', 'fieldset',
  'figcaption', 'figure', 'font', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'i', 'iframe', 'img', 'input', 'ins',
  'kbd', 'label', 'legend', 'li', 'link', 'main', 'map', 'mark', 'marquee', 'menu', 'meta',
  'meter', 'nav', 'nobr', 'noembed', 'noframes', 'noscript', 'object', 'ol', 'optgroup', 'option',
  'output', 'p', 'param', 'picture', 'plaintext', 'portal', 'pre', 'progress', 'q', 'rb', 'rp',
  'rt', 'rtc', 'ruby', 's', 'samp', 'script', 'search', 'section', 'select', 'slot', 'small',
  'source', 'span', 'strike', 'strong', 'style', 'sub', 'summary', 'sup', 'table', 'tbody', 'td',
  'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr', 'track', 'tt', 'u', 'ul',
  'var', 'video', 'wbr', 'xmp',
  'animate', 'animatemotion', 'animatetransform', 'circle', 'clippath', 'defs', 'desc', 'ellipse',
  'filter', 'foreignobject', 'g', 'hatch', 'hatchpath', 'image', 'line', 'lineargradient',
  'marker', 'mask', 'metadata', 'mpath', 'path', 'pattern', 'polygon', 'polyline',
  'radialgradient', 'rect', 'set', 'stop', 'svg', 'switch', 'symbol', 'text', 'textpath', 'tspan',
  'use', 'view',
  'annotation', 'annotation-xml', 'maction', 'math', 'merror', 'mfrac', 'mi', 'mmultiscripts',
  'mn', 'mo', 'mover', 'mpadded', 'mphantom', 'mprescripts', 'mroot', 'mrow', 'ms', 'mspace',
  'msqrt', 'mstyle', 'msub', 'msubsup', 'msup', 'mtable', 'mtd', 'mtext', 'mtr', 'munder',
  'munderover', 'semantics',
]);

/**
 * Agents commonly write angle-bracket placeholders such as `<id>` or `<token>` inside labels.
 * Those are plain text, not markup: allow a tag-like token only when it is a bare (optionally
 * closing) name that is not a known HTML/SVG/MathML element and not an SVG filter primitive.
 * Everything else tag-like — attributes, self-closing slash, or a real element name — is raw HTML.
 */
function isUnsafeTag(candidate: string): boolean {
  const bareName = /^<\s*\/?\s*([a-z][a-z0-9-]*)\s*>$/i.exec(candidate)?.[1]?.toLowerCase();
  if (!bareName) return true;
  return KNOWN_ELEMENT_NAMES.has(bareName) || /^fe[a-z]/.test(bareName);
}

/**
 * Mermaid's sequence grammar treats `;` as a statement separator even inside message and note
 * text, and quoting does not protect it. Escape semicolons that appear after the first colon of a
 * statement line with Mermaid's documented `#59;` entity, which renders as a visible semicolon.
 * Structural lines without a colon and `%%` comments are left untouched.
 */
function escapeSequenceMessageSemicolons(source: string): string {
  return source.split('\n').map((line) => {
    if (/^\s*%%/.test(line)) return line;
    const colon = line.indexOf(':');
    if (colon < 0 || !line.includes(';', colon)) return line;
    return line.slice(0, colon + 1) + line.slice(colon + 1).replaceAll(';', '#59;');
  }).join('\n');
}

/**
 * Mermaid interprets backticks inside a quoted label as its Markdown-string delimiter. Agents
 * commonly use Markdown inline-code around paths, which becomes invalid when more label content
 * (notably <br/>) follows the closing backtick. Strip only those delimiters inside complete quoted
 * strings; the visible text, Mermaid structure, evidence comments, and backticks outside labels
 * remain unchanged. Sequence diagrams additionally get their message-text semicolons escaped.
 */
export function normalizeMermaidSource(source: string): string {
  let normalized = source.replace(/"(?:\\.|[^"\\])*"/g, (quoted) => quoted.replaceAll('`', ''));
  const firstStatement = normalized.split('\n').find((line) => line.trim() && !line.trim().startsWith('%%'));
  if (firstStatement?.trim().startsWith('sequenceDiagram')) {
    normalized = escapeSequenceMessageSemicolons(normalized);
  }
  return normalized;
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
  const tagCandidates = sourceWithoutLineBreaks.match(/<\s*\/?\s*[a-z][^>]*>/gi) || [];
  if (tagCandidates.some(isUnsafeTag)) return { ok: false, error: 'Raw HTML is not allowed in diagrams' };
  return { ok: true };
}
