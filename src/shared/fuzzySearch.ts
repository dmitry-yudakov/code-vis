/** Rank subsequence matches, giving exact, prefix and contiguous name matches priority. */
export function fuzzySearch<T>(
  items: readonly T[], input: string, textOf: (item: T) => string, limit = items.length,
  nameOf = (text: string) => text,
): T[] {
  const query = input.toLowerCase().replace(/\s/g, '');
  if (!query) return items.slice(0, limit);
  const matches: { item: T; text: string; score: number }[] = [];
  for (const item of items) {
    const text = textOf(item);
    const normalized = text.toLowerCase();
    const name = nameOf(normalized);
    let previous = -1;
    let score = normalized.length / 100;
    for (const character of query) {
      const position = normalized.indexOf(character, previous + 1);
      if (position < 0) { score = Infinity; break; }
      score += position - previous - 1;
      previous = position;
    }
    if (!Number.isFinite(score)) continue;
    score -= name === query ? 10000 : name.startsWith(query) ? 5000 : name.includes(query) ? 1000 : normalized.includes(query) ? 500 : 0;
    matches.push({ item, text, score });
  }
  return matches.sort((a, b) => a.score - b.score || a.text.localeCompare(b.text))
    .slice(0, limit).map(match => match.item);
}
