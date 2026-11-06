export interface RepositoryFile { path: string; text: string }
export interface RepositoryDirectory {
  path: string;
  entries: { name: string; kind: 'file' | 'directory' }[];
}
