import { fuzzySearch } from '@/shared/fuzzySearch';

/** Rank a bounded set of visible results while keeping every supplied path searchable. */
export function fuzzyFiles<T extends { path: string }>(files: readonly T[], input: string, limit = 50): T[] {
  return fuzzySearch(files, input, file => file.path, limit, path => path.slice(path.lastIndexOf('/') + 1));
}
