import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { EvidenceResult } from '@/shared/types';

const EVIDENCE_LINE = /^\s*%%@evidence\s+([A-Za-z_][\w.-]*)\s*\|\s*([^|]+?)\s*\|\s*(observed|inferred)\s*$/gm;

function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function extractEvidence(source: string, repositoryRoot: string): Promise<EvidenceResult[]> {
  const results: EvidenceResult[] = [];
  const root = await realpath(repositoryRoot);
  for (const match of source.matchAll(EVIDENCE_LINE)) {
    const [, elementId, rawLocation, provenance] = match;
    const location = rawLocation.trim();
    const parsed = /^(.*):(\d+)(?:-(\d+))?$/.exec(location);
    if (!parsed) {
      results.push({ elementId, location, status: 'invalid', message: 'Invalid evidence location syntax.' });
      continue;
    }
    const [, relativePath, startRaw, endRaw] = parsed;
    const segments = relativePath.split('/');
    if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\\') || relativePath.includes('\0')
      || segments.some((segment) => !segment || segment === '..' || segment === '.')) {
      results.push({ elementId, location, status: 'outside-repository', message: 'Evidence must use a safe repository-relative path.' });
      continue;
    }
    const startLine = Number(startRaw);
    const endLine = Number(endRaw || startRaw);
    if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine) {
      results.push({ elementId, location, path: relativePath, status: 'invalid-range', message: 'Evidence line range is invalid.' });
      continue;
    }
    const unresolved = path.resolve(root, relativePath);
    if (!contained(root, unresolved)) {
      results.push({ elementId, location, status: 'outside-repository', message: 'Evidence resolves outside the repository.' });
      continue;
    }
    try {
      const filePath = await realpath(unresolved);
      const details = await stat(filePath);
      if (!contained(root, filePath) || !details.isFile()) {
        results.push({ elementId, location, path: relativePath, status: 'outside-repository', message: 'Evidence is not a regular repository file.' });
        continue;
      }
      const content = await readFile(filePath, 'utf8');
      const lineCount = content === '' ? 0 : content.split(/\r?\n/).length;
      if (endLine > lineCount) {
        results.push({ elementId, location, path: relativePath, startLine, endLine, status: 'invalid-range', message: 'Evidence range is outside the file.' });
        continue;
      }
      results.push({
        elementId, location, path: relativePath, startLine, endLine,
        status: provenance === 'observed' ? 'observed' : 'inferred',
        message: provenance === 'observed'
          ? 'Observed location exists; semantic correctness is not proven.'
          : 'Inferred from a real location; semantic correctness is not proven.',
      });
    } catch {
      results.push({ elementId, location, path: relativePath, status: 'missing-file', message: 'Evidence file does not exist.' });
    }
  }
  return results;
}
