import { getProjectFiles, openFile } from './utils';

let projectPath = '';
let files: string[] = [];
const hideFilesMasks: { [k: string]: RegExp } = {};

export const initProject = (_projectPath: string) => {
  projectPath = _projectPath;
  files = getProjectFiles(projectPath);
  console.log(files);
};

export const processCommand = async (command: string) => {
  let tokens = command
    .split(' ')
    .filter((word) => word)
    .map((word) => word.toLowerCase());
  console.log('tokens!', tokens);

  const unrecognized = () => {
    throw new Error('Could not recognize command: "' + command + '"');
  };

  let op = tokens.shift();
  switch (op) {
    // case 'open':
    //   if (tokens.length) openFile(tokens);
    //   break;
    case 'map': {
      const what = tokens.shift();
      if (what === 'project') {
        return projectMap();
      } else if (what === 'file') {
        const filename = tokens.shift();
        return fileMap(filename!);
      } else {
        unrecognized();
      }
      break;
    }
    case 'hide': {
      const maskName = tokens.join('|');
      const what = tokens.shift();
      let reString;
      if (what === 'directory') {
        reString = `^.*${tokens.join('.*')}\/`;
      } else if (what === 'file') {
        reString = `^.*${['/', ...tokens].join('.*')}[^/]`;
      } else {
        return unrecognized();
      }
      console.log('Ignore regex', reString);
      hideFilesMasks[maskName] = new RegExp(reString, 'i');

      return projectMap();
    }
    default:
      unrecognized();
  }
};

const projectMap = async () => {
  const data = await mapIncludes();
  console.log(data);
  return { type: 'projectMap', payload: data };
};

const fileMap = async (filename: string) => {
  const filesContents: Record<string, string> = {};
  await scanProjectFiles({
    forEveryFile: (name, content) => {
      filesContents[name] = content;
    },
  });

  const startFile = filesContents[filename];
  // console.log('mapFile', filesContents, filename, startFile);
  if (!startFile) throw new Error('File not found');

  let funcCalls: IFunctionCallInfo[] = [];

  const mapContent = (relativePath: string, content: string) => {
    console.log('in file', relativePath, 'check func call');
    const reFuncCall = /(.*[\s()])([a-zA-Z0-9_^(]+)\((.*)\)/gm;
    let max = 1000;
    do {
      let out = reFuncCall.exec(content);
      if (!out) break;
      const [, pre, name, args] = out;
      console.log('func call detected', name, pre);
      // console.log([relativePath, out[1]]);
      // console.log(relativePath, out[1], out[2]);
      funcCalls.push({
        args: [args],
        name: name,
        from: relativePath,
      });
    } while (--max);
  };

  mapContent(filename, startFile);

  return {
    type: 'fileMap',
    payload: { content: startFile, mapping: funcCalls },
  };
};

// tokenizeProjectFilenames().then(keywords => {
//     sendToWebsocket({ type: 'keywords', payload: keywords });
// });

type TScanFileCallback = (relativePath: string, content: string) => void;

const scanProjectFiles = async ({
  forEveryFile,
}: {
  forEveryFile: TScanFileCallback;
}) => {
  const files = await listProjectFiles(includeMask, 2000);

  for (const file of files) {
    if (shouldIgnoreFile(file)) {
      console.log('ignoring', file, 'because of path');
      continue;
    }
    const doc = await openFile(file, projectPath);
    // const relativePath = toRelativePath(file, projectPath);
    // const doc = await vscode.workspace.openTextDocument(file.path);
    // const relativePath = file.path.replace(vscode.workspace.rootPath, '');

    await forEveryFile(file, doc);
  }
};

interface IFileIncludeInfo {
  to: string;
  from: string;
  items: string[];
}
interface IFunctionCallInfo {
  name: string;
  from: string;
  args: string[];
}

const autoAppendJSextensionInPlace = (
  info: IFileIncludeInfo,
  projectFiles: string[]
) => {
  const { from } = info;
  for (let filename of projectFiles) {
    if (
      filename.indexOf(from) === 0 &&
      filename.length !== from.length &&
      filename[from.length] === '.'
    ) {
      info.from = filename;
      break;
    }
  }
};

const resolveRelativeIncludePathInPlace = (info: IFileIncludeInfo) => {
  const re = /\//;
  const { to, from } = info;
  const pathTokens = to.split(re).filter((t) => !!t);
  pathTokens.pop(); // remove filename and leave only path

  const fromTokens = from.split(re).filter((t) => !!t);

  for (const token of fromTokens) {
    if (token === '.') {
      // noop
    } else if (token === '..') {
      pathTokens.pop();
    } else {
      pathTokens.push(token);
    }
  }
  // info.from = '/' + pathTokens.join('/');
  info.from = pathTokens.join('/');
  // console.log(info.from, info.to);
};

const mapIncludes = async () => {
  let includes: IFileIncludeInfo[] = [];
  const parseAndStoreIncludes: TScanFileCallback = (relativePath, content) => {
    const re = /^import (.+) from ['"](\..+)['"]/gm;
    const re2 = /^(const|let|var) (.+) = require\(['"](\..+)['"]\)/gm;
    // console.log('doc text', doc.getText());
    // console.log('analyze', relativePath);
    do {
      let out = re.exec(content);
      if (!out) break;
      const [, what, whereFrom] = out;
      const whatSplit = what.split(/[,\s{}]+/).filter((t) => !!t);
      // console.log([relativePath, out[1]]);
      // console.log(relativePath, out[1], out[2]);
      includes.push({
        items: whatSplit,
        to: relativePath,
        from: whereFrom,
      });
    } while (1);
    do {
      let out = re2.exec(content);
      if (!out) break;
      const [, , what, whereFrom] = out;
      const whatSplit = what.split(/[,\s{}]+/).filter((t) => !!t);
      // console.log([relativePath, out[1]]);
      // console.log(relativePath, out[1], out[2]);
      includes.push({
        items: whatSplit,
        to: relativePath,
        from: whereFrom,
      });
    } while (1);
  };

  await scanProjectFiles({
    forEveryFile: parseAndStoreIncludes,
  });

  includes = includes.filter(({ from, ...rest }) => {
    const ignore = shouldIgnoreFile(from);
    if (ignore) console.log('ignoring "from"', from, rest);
    return !ignore;
  });

  includes.forEach(resolveRelativeIncludePathInPlace);

  const projectFilesRelative = await listProjectFiles();
  // .map((file) => file)
  // .map((f) => toRelativePath(f, projectPath));
  console.log(projectFilesRelative);
  includes.forEach((info) =>
    autoAppendJSextensionInPlace(info, projectFilesRelative)
  );

  return includes;
};

const mapFile = async (filename: string) => {
  const filesContents: Record<string, string> = {};
  await scanProjectFiles({
    forEveryFile: (name, content) => {
      filesContents[name] = content;
    },
  });

  const startFile = filesContents[filename];
  // console.log('mapFile', filesContents, filename, startFile);
  if (!startFile) throw new Error('File not found');

  let funcCalls: IFunctionCallInfo[] = [];

  const mapContent = (relativePath: string, content: string) => {
    console.log('in file', relativePath, 'check func call');
    const reFuncCall = /(.*[\s()])([a-zA-Z0-9_^(]+)\((.*)\)/gm;
    let max = 1000;
    do {
      let out = reFuncCall.exec(content);
      if (!out) break;
      const [, pre, name, args] = out;
      console.log('func call detected', name, pre);
      // console.log([relativePath, out[1]]);
      // console.log(relativePath, out[1], out[2]);
      funcCalls.push({
        args: [args],
        name: name,
        from: relativePath,
      });
    } while (--max);
  };

  mapContent(filename, startFile);

  return [{ content: startFile, mapping: funcCalls }];
};

const includeMask = '**/*.{ts,tsx,js,jsx}';
const excludeMask = '**/node_modules/**';

const listProjectFiles = async (include = includeMask, limit = 10000) => {
  // let conf = vscode.workspace.getConfiguration('search', null);
  // let excludeConf = conf.get('exclude');
  // let excludeStr = `{${Object.keys(excludeConf)
  //   .filter((key) => excludeConf[key])
  //   .join(',')}}`;
  // const files = await vscode.workspace.findFiles(include, excludeStr, limit);
  return files;
};

const shouldIgnoreFile = (filePath: string) => {
  for (const key in hideFilesMasks) {
    const re = hideFilesMasks[key];
    if (re.test(filePath)) {
      console.log('ignore', filePath, key, re);
      return true;
    }
  }
  return false;
};
