import { getProjectFiles, openFile } from './io';
import {
  IFunctionCallInfo,
  TScanFileCallback,
  IFileIncludeInfo,
} from './types';
import {
  resolveRelativeIncludePathInPlace,
  autoAppendJSextensionInPlace,
} from './utils';

const includeMask = '**/*.{ts,tsx,js,jsx}';
const excludeMask = '**/node_modules/**';

export default class Project {
  public files: string[] = [];
  public hideFilesMasks: { [k: string]: RegExp } = {};

  constructor(public projectPath: string) {
    this.files = getProjectFiles(projectPath);
    console.log(this.files);
  }

  processCommand = async (command: string) => {
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
          return this.projectMap();
        } else if (what === 'file') {
          const filename = tokens.shift();
          return this.fileMap(filename!);
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
        this.hideFilesMasks[maskName] = new RegExp(reString, 'i');

        return this.projectMap();
      }
      default:
        unrecognized();
    }
  };

  async projectMap() {
    const data = await this.mapIncludes();
    console.log(data);
    return { type: 'projectMap', payload: data };
  }

  async fileMap(filename: string) {
    const filesContents: Record<string, string> = {};
    await this.scanProjectFiles({
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
  }

  async mapIncludes() {
    let includes: IFileIncludeInfo[] = [];
    const parseAndStoreIncludes: TScanFileCallback = (
      relativePath,
      content
    ) => {
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

    await this.scanProjectFiles({
      forEveryFile: parseAndStoreIncludes,
    });

    includes = includes.filter(({ from, ...rest }) => {
      const ignore = this.shouldIgnoreFile(from);
      if (ignore) console.log('ignoring "from"', from, rest);
      return !ignore;
    });

    includes.forEach(resolveRelativeIncludePathInPlace);

    const projectFilesRelative = await this.listProjectFiles();
    // .map((file) => file)
    // .map((f) => toRelativePath(f, projectPath));
    console.log(projectFilesRelative);
    includes.forEach((info) =>
      autoAppendJSextensionInPlace(info, projectFilesRelative)
    );

    return includes;
  }

  async mapFile(filename: string) {
    const filesContents: Record<string, string> = {};
    await this.scanProjectFiles({
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
  }

  async scanProjectFiles({
    forEveryFile,
  }: {
    forEveryFile: TScanFileCallback;
  }) {
    const files = await this.listProjectFiles(includeMask, 2000);

    for (const file of files) {
      if (this.shouldIgnoreFile(file)) {
        console.log('ignoring', file, 'because of path');
        continue;
      }
      const doc = await openFile(file, this.projectPath);
      // const relativePath = toRelativePath(file, projectPath);
      // const doc = await vscode.workspace.openTextDocument(file.path);
      // const relativePath = file.path.replace(vscode.workspace.rootPath, '');

      await forEveryFile(file, doc);
    }
  }

  listProjectFiles(include = includeMask, limit = 10000) {
    // let conf = vscode.workspace.getConfiguration('search', null);
    // let excludeConf = conf.get('exclude');
    // let excludeStr = `{${Object.keys(excludeConf)
    //   .filter((key) => excludeConf[key])
    //   .join(',')}}`;
    // const files = await vscode.workspace.findFiles(include, excludeStr, limit);
    return this.files;
  }

  shouldIgnoreFile = (filePath: string) =>
    Object.entries(this.hideFilesMasks).some(([key, re]) => {
      if (re.test(filePath)) {
        console.log('ignore', filePath, key, re);
        return true;
      }
      return false;
    });
}
