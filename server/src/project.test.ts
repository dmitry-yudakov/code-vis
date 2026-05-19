import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Project from './project';

const runGit = (cwd: string, args: string[]) => {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
};

const writeProjectFile = (root: string, filename: string, content: string) => {
  fs.writeFileSync(path.join(root, filename), content);
};

describe('Focused review mapping', () => {
  test('includes short bridge paths between changed declarations', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'code-ai-review-'));

    try {
      writeProjectFile(
        root,
        'a.ts',
        "import { mid } from './mid';\n\nexport function changedA() {\n  return mid();\n}\n"
      );
      writeProjectFile(
        root,
        'mid.ts',
        "import { changedB } from './b';\n\nexport function mid() {\n  return changedB();\n}\n"
      );
      writeProjectFile(
        root,
        'b.ts',
        'export function changedB() {\n  return 1;\n}\n'
      );

      runGit(root, ['init']);
      runGit(root, ['config', 'user.email', 'test@example.com']);
      runGit(root, ['config', 'user.name', 'Test User']);
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-m', 'initial']);

      writeProjectFile(
        root,
        'a.ts',
        "import { mid } from './mid';\n\nexport function changedA() {\n  return mid() + 1;\n}\n"
      );
      writeProjectFile(
        root,
        'b.ts',
        'export function changedB() {\n  return 2;\n}\n'
      );

      const project = new Project(root, { includeMask: '**/*.ts' });
      const result = await project.handleCommandFocusedReview({ mode: 'diff' });
      const bridgeDeclarations = result.payload.declarations.filter((decl) =>
        decl.reasons.some((reason) => reason.type === 'bridge-between-changes')
      );
      const bridgeCalls = result.payload.declarationCalls.filter((call) =>
        call.reasons.some((reason) => reason.type === 'bridge-between-changes')
      );

      expect(
        result.payload.declarations
          .filter((decl) => decl.isChanged)
          .map((decl) => decl.name)
          .sort()
      ).toEqual(['changedA', 'changedB']);
      expect(bridgeDeclarations.map((decl) => decl.name)).toEqual(['mid']);
      expect(bridgeCalls.map((call) => call.name).sort()).toEqual([
        'changedB',
        'mid',
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
