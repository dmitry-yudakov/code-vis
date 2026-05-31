import fs from 'fs';
import os from 'os';
import path from 'path';
import ProjectRegistry from './projectRegistry';

const makeTempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'code-ai-projects-'));

const writeFile = (root: string, filename: string, content = '{}') => {
  fs.mkdirSync(path.dirname(path.join(root, filename)), { recursive: true });
  fs.writeFileSync(path.join(root, filename), content);
};

describe('ProjectRegistry discovery', () => {
  test('treats a marked root as a single project by default', async () => {
    const root = makeTempRoot();

    try {
      writeFile(root, 'package.json');
      fs.mkdirSync(path.join(root, 'src'));

      const registry = new ProjectRegistry(root);
      await registry.initialize();

      const list = registry.getProjectList();
      expect(list.projects).toHaveLength(1);
      expect(list.projects[0]).toMatchObject({
        name: path.basename(root),
        path: root,
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('prefers marked child project directories in directory mode', async () => {
    const root = makeTempRoot();

    try {
      writeFile(root, 'app/package.json');
      fs.mkdirSync(path.join(root, 'docs'));

      const registry = new ProjectRegistry(root);
      await registry.initialize();

      const list = registry.getProjectList();
      expect(list.projects.map((project) => project.name)).toEqual(['app']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('uses discovery depth to find nested marked project directories', async () => {
    const root = makeTempRoot();

    try {
      writeFile(root, 'packages/api/package.json');

      const shallowRegistry = new ProjectRegistry(root);
      await shallowRegistry.initialize();
      expect(
        shallowRegistry.getProjectList().projects.map((project) => project.name)
      ).toEqual(['packages']);

      const nestedRegistry = new ProjectRegistry(root, {
        discoveryDepth: 2,
      });
      await nestedRegistry.initialize();

      expect(
        nestedRegistry.getProjectList().projects.map((project) => project.name)
      ).toEqual(['packages/api']);
      expect(nestedRegistry.getProjectList().projects[0].relativePath).toBe(
        'packages/api'
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('can force directory mode even when the root is marked', async () => {
    const root = makeTempRoot();

    try {
      writeFile(root, 'package.json');
      writeFile(root, 'web/package.json');

      const registry = new ProjectRegistry(root, {
        forceProjectsDirectory: true,
      });
      await registry.initialize();

      const list = registry.getProjectList();
      expect(list.projects.map((project) => project.name)).toEqual(['web']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
