import { MAX_DRAFT_LENGTH } from '@/shared/voice';

export interface DraftToken { start: number; end: number; text: string; }
export function draftTokens(text: string): DraftToken[] {
  return [...text.matchAll(/\S+|\n/g)].map((match) => ({ start: match.index, end: match.index + match[0].length, text: match[0] }));
}

const alphabet = 'alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu'.split(' ');
const spelling: Record<string, string> = {
  ...Object.fromEntries(alphabet.map((word, i) => [word, String.fromCharCode(97 + i)])),
  alfa: 'a', juliet: 'j', 'x-ray': 'x', whisky: 'w',
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  slash: '/', backslash: '\\', dot: '.', underscore: '_', dash: '-', hyphen: '-', space: ' ', newline: '\n',
  colon: ':', semicolon: ';', comma: ',', quote: '"', apostrophe: "'", equals: '=', plus: '+', star: '*',
  at: '@', hash: '#', dollar: '$', percent: '%', ampersand: '&', question: '?', exclamation: '!',
  backtick: '`', tilde: '~', pipe: '|', caret: '^',
  'open-parenthesis': '(', 'close-parenthesis': ')', 'open-bracket': '[', 'close-bracket': ']',
  'open-brace': '{', 'close-brace': '}', less: '<', greater: '>',
};

/** Spelling is an explicit review operation. Unknown words fail instead of inventing an identifier. */
export function spellVoiceText(text: string): string {
  const words = text.toLowerCase().replace(/new\s+line/g, 'newline')
    .replace(/(open|close)\s+(parenthesis|bracket|brace)/g, '$1-$2').replace(/[.,!?]/g, '').trim().split(/\s+/);
  let result = '';
  let capital = false;
  for (const word of words) {
    if (word === 'capital' || word === 'uppercase') { capital = true; continue; }
    const char = spelling[word] ?? (/^[a-z0-9]$/.test(word) ? word : undefined);
    if (char === undefined) throw new Error(`Spelling did not recognize “${word.slice(0, 40)}”. Use NATO words, digits, or symbol names.`);
    result += capital ? char.toUpperCase() : char;
    capital = false;
  }
  if (capital) throw new Error('Say a letter after “capital”.');
  return result;
}

export function editVoiceDraft(draft: string, replacement: string, selection?: DraftToken): string {
  const next = selection ? draft.slice(0, selection.start) + replacement + draft.slice(selection.end)
    : draft + (draft && replacement && !/\s$/.test(draft) && !/^\s/.test(replacement) ? ' ' : '') + replacement;
  if (next.length > MAX_DRAFT_LENGTH) throw new Error('Draft limit is 8,000 characters. Shorten it before adding speech.');
  return next;
}
