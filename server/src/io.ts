import { glob } from 'glob';
import { promises as fs } from 'fs';
import path from 'path';

export const getProjectFiles = (
  projectPath: string,
  includeMask: string,
  excludeMask?: string
) => {
  const absolutePath = path.resolve(projectPath);
  const reAbsPath = new RegExp(`^${absolutePath}/`);
  return glob
    .sync(
      path.join(absolutePath, includeMask),
      excludeMask ? { ignore: excludeMask } : undefined
    )
    .map((fullPath) => fullPath.replace(reAbsPath, ''));
};

export const openFile = async (filename: string, projectPath: string) => {
  const fullpath = path.join(projectPath, filename);
  return fs.readFile(fullpath).then((b) => b.toString());
};
