import { glob } from 'glob';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { ProjectChangeEvent, ProjectConfig } from './types';
import chokidar from 'chokidar';

export const getProjectFiles = (
  projectPath: string,
  includeMask: string,
  excludeMask?: string | string[]
) => {
  const absolutePath = path.resolve(projectPath);
  const reAbsPath = new RegExp(`^${absolutePath}/`);
  return glob
    .sync(path.join(absolutePath, includeMask), { ignore: excludeMask })
    .map((fullPath) => fullPath.replace(reAbsPath, ''));
};

export const openFile = async (filename: string, projectPath: string) => {
  const fullpath = path.join(projectPath, filename);
  return fs.readFile(fullpath).then((b) => b.toString());
};

export const watchDirectory = (
  path: string,
  onChange: (e: ProjectChangeEvent) => void
) => {
  const watcher = chokidar.watch('.', {
    cwd: path,
    ignoreInitial: true,
    persistent: true,
  });
  watcher
    .on('add', (path) => onChange({ type: 'add', path }))
    .on('change', (path) => onChange({ type: 'change', path }))
    .on('unlink', (path) => onChange({ type: 'remove', path }));
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
