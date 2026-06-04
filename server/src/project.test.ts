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

  test('tags related tests and honors the includeTests option', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'code-ai-review-'));

    try {
      writeProjectFile(
        root,
        'subject.ts',
        'export function subject() {\n  return 1;\n}\n'
      );
      writeProjectFile(
        root,
        'subject.test.ts',
        "import { subject } from './subject';\n\ntest('subject', () => {\n  expect(subject()).toBe(1);\n});\n"
      );

      runGit(root, ['init']);
      runGit(root, ['config', 'user.email', 'test@example.com']);
      runGit(root, ['config', 'user.name', 'Test User']);
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-m', 'initial']);

      writeProjectFile(
        root,
        'subject.ts',
        'export function subject() {\n  return 2;\n}\n'
      );

      const project = new Project(root, { includeMask: '**/*.ts' });
      const withTests = await project.handleCommandFocusedReview(
        { mode: 'diff' },
        { includeTests: true }
      );
      const relatedTest = withTests.payload.files.find(
        (file) => file.filename === 'subject.test.ts'
      );

      expect(relatedTest).toMatchObject({
        filename: 'subject.test.ts',
        isChanged: false,
        isTest: true,
      });
      expect(relatedTest?.reasons).toContainEqual({
        type: 'related-test',
        via: 'subject.ts',
      });

      const withoutTests = await project.handleCommandFocusedReview(
        { mode: 'diff' },
        { includeTests: false }
      );

      expect(
        withoutTests.payload.files.some(
          (file) => file.filename === 'subject.test.ts'
        )
      ).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('hides changed test files when includeTests is off', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'code-ai-review-'));

    try {
      writeProjectFile(
        root,
        'subject.ts',
        'export function subject() {\n  return 1;\n}\n'
      );
      writeProjectFile(
        root,
        'subject.test.ts',
        "import { subject } from './subject';\n\ntest('subject', () => {\n  expect(subject()).toBe(1);\n});\n"
      );

      runGit(root, ['init']);
      runGit(root, ['config', 'user.email', 'test@example.com']);
      runGit(root, ['config', 'user.name', 'Test User']);
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-m', 'initial']);

      // Change both the subject AND its test, so the test file is itself part
      // of the changeset (not merely a related test).
      writeProjectFile(
        root,
        'subject.ts',
        'export function subject() {\n  return 2;\n}\n'
      );
      writeProjectFile(
        root,
        'subject.test.ts',
        "import { subject } from './subject';\n\ntest('subject', () => {\n  expect(subject()).toBe(2);\n});\n"
      );

      const project = new Project(root, { includeMask: '**/*.ts' });

      const withTests = await project.handleCommandFocusedReview(
        { mode: 'diff' },
        { includeTests: true }
      );
      const changedTest = withTests.payload.files.find(
        (file) => file.filename === 'subject.test.ts'
      );
      expect(changedTest).toMatchObject({
        filename: 'subject.test.ts',
        isChanged: true,
        isTest: true,
      });

      const withoutTests = await project.handleCommandFocusedReview(
        { mode: 'diff' },
        { includeTests: false }
      );
      // Even though it is a changed file, the test node must disappear entirely.
      expect(
        withoutTests.payload.files.some(
          (file) => file.filename === 'subject.test.ts'
        )
      ).toBe(false);
      // The changed source file still shows.
      expect(
        withoutTests.payload.files.some(
          (file) => file.filename === 'subject.ts'
        )
      ).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('maps the patch introduced by a selected commit', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'code-ai-review-'));

    try {
      writeProjectFile(
        root,
        'subject.ts',
        'export function subject() {\n  return 1;\n}\n'
      );

      runGit(root, ['init']);
      runGit(root, ['config', 'user.email', 'test@example.com']);
      runGit(root, ['config', 'user.name', 'Test User']);
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-m', 'initial']);

      writeProjectFile(
        root,
        'subject.ts',
        'export function subject() {\n  return 2;\n}\n'
      );
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-m', 'change subject']);

      const project = new Project(root, { includeMask: '**/*.ts' });
      const result = await project.handleCommandFocusedReview({
        mode: 'commit',
        ref: 'HEAD',
      });

      expect(result.payload.changeSet.source).toMatchObject({
        mode: 'commit',
      });
      expect(result.payload.changeSet.files).toMatchObject([
        {
          filename: 'subject.ts',
          status: 'modified',
          addedLines: [{ start: 2, end: 2 }],
        },
      ]);
      expect(
        result.payload.declarations
          .filter((decl) => decl.isChanged)
          .map((decl) => decl.name)
      ).toEqual(['subject']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('marks a new file inside a new directory as added (not collapsed)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'code-ai-review-'));

    try {
      writeProjectFile(
        root,
        'app.ts',
        "import { child } from './newdir/child';\n\nexport function app() {\n  return child();\n}\n"
      );

      runGit(root, ['init']);
      runGit(root, ['config', 'user.email', 'test@example.com']);
      runGit(root, ['config', 'user.name', 'Test User']);
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-m', 'initial']);

      // A brand-new file in a brand-new, still-untracked directory: git would
      // otherwise collapse this to a single `newdir/` entry in `status`.
      fs.mkdirSync(path.join(root, 'newdir'));
      writeProjectFile(
        root,
        'newdir/child.ts',
        'export function child() {\n  return 1;\n}\n'
      );

      const project = new Project(root, { includeMask: '**/*.ts' });
      const result = await project.handleCommandFocusedReview({ mode: 'diff' });

      const child = result.payload.changeSet.files.find(
        (file) => file.filename === 'newdir/child.ts'
      );
      expect(child?.status).toBe('added');
      // No phantom directory entry leaks into the change set.
      expect(
        result.payload.changeSet.files.some((file) =>
          file.filename.endsWith('/')
        )
      ).toBe(false);
      // The real file is marked changed/added at the focused-file level too.
      expect(
        result.payload.files.find(
          (file) => file.filename === 'newdir/child.ts'
        )
      ).toMatchObject({ isChanged: true, changeStatus: 'added' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('emits class/method/constant entities and a declares relation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'code-ai-review-'));

    try {
      writeProjectFile(root, 'seed.ts', 'export const seed = 1;\n');

      runGit(root, ['init']);
      runGit(root, ['config', 'user.email', 'test@example.com']);
      runGit(root, ['config', 'user.name', 'Test User']);
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-m', 'initial']);

      writeProjectFile(
        root,
        'repo.ts',
        "export const API_BASE = 'http://localhost';\n\nexport class Repo {\n  getUser(id) {\n    return id;\n  }\n}\n"
      );
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-m', 'add repo']);

      const project = new Project(root, { includeMask: '**/*.ts' });
      const result = await project.handleCommandFocusedReview({
        mode: 'commit',
        ref: 'HEAD',
      });

      const entities = result.payload.entities || [];
      const relations = result.payload.relations || [];

      const repoClass = entities.find(
        (entity) => entity.kind === 'class' && entity.name === 'Repo'
      );
      const getUser = entities.find(
        (entity) => entity.kind === 'method' && entity.name === 'getUser'
      );
      const apiBase = entities.find(
        (entity) => entity.kind === 'constant' && entity.name === 'API_BASE'
      );

      // Ids follow the settled scheme (kind:file#container.name, no pos).
      expect(repoClass?.id).toBe('class:repo.ts#Repo');
      expect(getUser?.id).toBe('method:repo.ts#Repo.getUser');
      expect(getUser?.container).toBe('Repo');
      expect(apiBase?.id).toBe('constant:repo.ts#API_BASE');

      // A file entity anchors the new declarations.
      expect(
        entities.some(
          (entity) =>
            entity.kind === 'file' && entity.location?.filename === 'repo.ts'
        )
      ).toBe(true);

      // Class declares its method; relation ids derive from endpoint ids.
      expect(
        relations.some(
          (relation) =>
            relation.kind === 'declares' &&
            relation.source === repoClass?.id &&
            relation.target === getUser?.id
        )
      ).toBe(true);

      // Change status stays diff-driven (the file is added -> entities added).
      expect(repoClass?.changeStatus).toBe('added');
      expect(getUser?.changeStatus).toBe('added');
      expect(apiBase?.changeStatus).toBe('added');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('lists recent commits from the current branch', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'code-ai-review-'));

    try {
      writeProjectFile(root, 'subject.ts', 'export const value = 1;\n');

      runGit(root, ['init']);
      runGit(root, ['config', 'user.email', 'test@example.com']);
      runGit(root, ['config', 'user.name', 'Test User']);
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-m', 'initial']);

      writeProjectFile(root, 'subject.ts', 'export const value = 2;\n');
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-m', 'second']);

      const project = new Project(root, { includeMask: '**/*.ts' });
      const result = await project.handleCommandListCommits({
        limit: 1,
        skip: 0,
      });

      expect(result.payload).toHaveLength(1);
      expect(result.payload[0]).toMatchObject({
        subject: 'second',
        authorName: 'Test User',
      });
      expect(result.payload[0].hash).toHaveLength(40);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
