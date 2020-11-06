import { glob } from 'glob';
import { promises as fs } from 'fs';
import path from 'path';

export const getProjectFiles = (projectPath: string) => {
  const reIgnore = /(node_modules|\.js\.map$)/;

  const absolutePath = path.resolve(projectPath);
  const reAbsPath = new RegExp(`^${absolutePath}/`);
  return glob
    .sync(
      absolutePath + '/**/*.{js,jsx,ts,tsx}'
      // { ignore: '**/node_modules/**' } <-- doesn't work
    )
    .filter((f) => !reIgnore.test(f))
    .map((fullPath) => fullPath.replace(reAbsPath, ''));
};

export const openFile = async (filename: string, projectPath: string) => {
  const fullpath = path.join(projectPath, filename);
  return fs.readFile(fullpath).then((b) => b.toString());
};
