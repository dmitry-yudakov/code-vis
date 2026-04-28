import { glob } from 'glob';
import { promises as fs, readFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { ProjectChangeEvent, ProjectConfig } from './types';
import chokidar from 'chokidar';
import ignore from 'ignore';

// Builds a filter function that returns true if a project-relative path
// should be ignored according to any .gitignore file in the tree.
const buildGitignoreFilter = (absolutePath: string) => {
  const gitignorePaths = glob.sync('**/.gitignore', {
    cwd: absolutePath,
    dot: true,
    ignore: ['**/node_modules/**'],
  });

  const filters: Array<{ prefix: string; ig: ReturnType<typeof ignore> }> = [];
  for (const gitignoreRelPath of gitignorePaths) {
    const dir = path.dirname(gitignoreRelPath); // '.' for root
    const prefix = dir === '.' ? '' : dir + '/';
    const ig = ignore();
    ig.add(readFileSync(path.join(absolutePath, gitignoreRelPath)).toString());
    filters.push({ prefix, ig });
  }

  return (relPath: string) =>
    filters.some(
      ({ prefix, ig }) =>
        relPath.startsWith(prefix) && ig.ignores(relPath.slice(prefix.length))
    );
};

export const getProjectFiles = (
  projectPath: string,
  includeMask: string,
  excludeMask?: string | string[]
) => {
  const absolutePath = path.resolve(projectPath);
  const reAbsPath = new RegExp(`^${absolutePath}/`);

  const isIgnored = buildGitignoreFilter(absolutePath);

  return glob
    .sync(path.join(absolutePath, includeMask), { ignore: excludeMask })
    .map((fullPath) => fullPath.replace(reAbsPath, ''))
    .filter((f) => !isIgnored(f));
};

export const openFile = async (filename: string, projectPath: string) => {
  const fullpath = path.join(projectPath, filename);
  return fs.readFile(fullpath).then((b) => b.toString());
};

export const saveFile = async (
  filename: string,
  projectPath: string,
  content: string
) => {
  const fullpath = path.join(projectPath, filename);
  return fs.writeFile(fullpath, content);
};

export const watchDirectory = (
  projectPath: string,
  onChange: (e: ProjectChangeEvent) => void
) => {
  const absolutePath = path.resolve(projectPath);
  const isIgnored = buildGitignoreFilter(absolutePath);

  const watcher = chokidar.watch('.', {
    cwd: absolutePath,
    ignoreInitial: true,
    persistent: true,
    ignored: (filePath: string) => {
      // chokidar passes absolute paths; convert to project-relative
      const prefix = absolutePath + path.sep;
      if (!filePath.startsWith(prefix)) return false;
      const relPath = filePath.slice(prefix.length);
      if (!relPath) return false;
      return isIgnored(relPath);
    },
  });
  watcher
    .on('add', (p) => onChange({ type: 'add', path: p }))
    .on('change', (p) => onChange({ type: 'change', path: p }))
    .on('unlink', (p) => onChange({ type: 'remove', path: p }));
};

const configsPath = path.join(homedir(), '/.code-ai');

const getProjectConfPath = (projectPath: string) => {
  const resolvedPath = path.resolve(projectPath);
  // console.log('Load conf for', resolvedPath);
  const configFilename = path.join(
    configsPath,
    'projects',
    encodeURIComponent(resolvedPath),
    'config.json'
  );
  console.log('Config', configFilename);
  return configFilename;
};

export const defaultConfig = {
  includeMask: '**/*.{ts,tsx,js,jsx}',
  excludeMask: ['**/node_modules/**'],
};

export const loadConfiguration = async (
  projectPath: string
): Promise<null | ProjectConfig> => {
  const configFilename = getProjectConfPath(projectPath);
  return fs
    .readFile(configFilename)
    .then((buf) => {
      const raw = buf.toString('utf-8');
      console.log('Loaded config:', raw);
      return JSON.parse(raw);
    })
    .catch((err) => {
      if (err.code === 'ENOENT') {
        console.log('Config does not exist');
        return null;
      }
      console.log('Error reading', configsPath, err);
      throw err;
    });
};
export const saveConfiguration = async (
  projectPath: string,
  conf: ProjectConfig
): Promise<void> => {
  const configFilename = getProjectConfPath(projectPath);
  return fs
    .mkdir(path.dirname(configFilename), { recursive: true })
    .then(() => fs.writeFile(configFilename, JSON.stringify(conf, null, 2)));
};
