import { IFileIncludeInfo, IFunctionCallInfo } from './../types';

const extractIncludes = (relativePath: string, content: string) => {
  const includes: IFileIncludeInfo[] = [];
  const re = /^(\s*)import (.+) from ['"](\..+)['"]/gm;
  // console.log('Analyze', relativePath, content);

  do {
    let out = re.exec(content);
    if (!out) break;
    const [, , what, whereFrom] = out;
    // console.log('include with import', { what, whereFrom });
    const whatSplit = what.split(/[,\s{}]+/).filter((t) => !!t);
    includes.push({
      items: whatSplit,
      to: relativePath,
      from: whereFrom,
    });
  } while (1);

  const re2 = /^(\s*)(const|let|var) (.+) = require\(['"](\..+)['"]\)/gm;

  do {
    let out = re2.exec(content);
    // console.log('include with require', out);
    if (!out) break;
    const [, , , what, whereFrom] = out;
    // console.log('include with require', { what, whereFrom });
    const whatSplit = what.split(/[,\s{}]+/).filter((t) => !!t);
    includes.push({
      items: whatSplit,
      to: relativePath,
      from: whereFrom,
    });
  } while (1);
  return includes;
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

const autoAppendJSextensionInPlace = (
  info: IFileIncludeInfo,
  projectFiles: string[]
) => {
  const { from } = info;
  for (let filename of projectFiles) {
    if (
      filename.length > from.length &&
      filename.length - from.length <= 5 &&
      filename.indexOf(from) === 0 &&
      filename[from.length] === '.'
    ) {
      console.log('AutoComplete', from, 'to', filename);
      info.from = filename;
      break;
    }
  }
};

const extractFilesHierarchy = async (
  filenames: string[],
  getFileContent: (filename: string) => Promise<string>
): Promise<IFileIncludeInfo[]> => {
  const includes: IFileIncludeInfo[] = await Promise.all(
    filenames.map(async (filename) => {
      const content = await getFileContent(filename);
      return extractIncludes(filename, content);
    })
  ).then((nestedIncludes) => nestedIncludes.flat());

  includes.forEach(resolveRelativeIncludePathInPlace);

  includes.forEach((info) => autoAppendJSextensionInPlace(info, filenames));

  return includes;
};

const extractFileMapping = (relativePath: string, content: string) => {
  let funcCalls: IFunctionCallInfo[] = [];

  // console.log('in file', relativePath, 'check func call');
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
  return funcCalls;
};

export default {
  extractFilesHierarchy,
  extractFileMapping,
};
