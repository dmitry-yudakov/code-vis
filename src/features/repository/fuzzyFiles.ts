/** Rank a bounded set of visible results while keeping every supplied path searchable. */
export function fuzzyFiles<T extends { path: string }>(files: readonly T[], input: string, limit = 50): T[] {
  const query = input.toLowerCase().replace(/\s/g, '');
  if (!query) return files.slice(0, limit);
  const matches: { file: T; score: number }[] = [];
  for (const file of files) {
    const path = file.path.toLowerCase();
    const name = path.slice(path.lastIndexOf('/') + 1);
    let previous = -1;
    let score = path.length / 100;
    for (const character of query) {
      const position = path.indexOf(character, previous + 1);
      if (position < 0) { score = Infinity; break; }
      score += position - previous - 1;
      previous = position;
    }
    if (!Number.isFinite(score)) continue;
    score -= name === query ? 10000 : name.startsWith(query) ? 5000 : name.includes(query) ? 1000 : path.includes(query) ? 500 : 0;
    matches.push({ file, score });
  }
  return matches.sort((a, b) => a.score - b.score || a.file.path.localeCompare(b.file.path))
    .slice(0, limit).map(item => item.file);
}
