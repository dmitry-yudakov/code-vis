import { getProjectFiles, openFile } from './io';
import {
  IFunctionCallInfo,
  TScanFileCallback,
  IFileIncludeInfo,
  ProjectConfig,
} from './types';
import {
  resolveRelativeIncludePathInPlace,
  autoAppendJSextensionInPlace,
} from './utils';

export default class Project {
  public files: string[] = [];
  public hideFilesMasks: { [k: string]: RegExp } = {};

  constructor(private projectPath: string, private config: ProjectConfig) {
    this.files = getProjectFiles(
      projectPath,
      config.includeMask,
      config.excludeMask
    );
    console.log('Project files:', this.files);
    console.log(
      'Loaded total',
      this.files.length,
      'files from',
      projectPath,
      'config:',
      config
    );
  }

  processCommand = async (type: string, payload: string | undefined) => {
    // let tokens = type.split(' ').filter((word) => word);
    console.log('Process command', { type, payload });

    switch (type) {
      case 'mapProject':
        return this.projectMap();
      case 'mapFile':
        return this.fileMap(payload!);
      default:
        throw new Error('Could not recognize command: "' + type + '"');
    }
    // case 'hide': {
    //   const maskName = tokens.join('|');
    //   const what = tokens.shift();
    //   let reString;
    //   if (what === 'directory') {
    //     reString = `^.*${tokens.join('.*')}\/`;
    //   } else if (what === 'file') {
    //     reString = `^.*${['/', ...tokens].join('.*')}[^/]`;
    //   } else {
    //     return unrecognized();
    //   }
    //   console.log('Ignore regex', reString);
    //   this.hideFilesMasks[maskName] = new RegExp(reString, 'i');

    //   return this.projectMap();
    // }
  };

  async projectMap() {
    const data = await this.mapIncludes();
    // console.log(data);
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

    includes.forEach((info) => autoAppendJSextensionInPlace(info, this.files));

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
    for (const file of this.files) {
      if (this.shouldIgnoreFile(file)) {
        console.log('ignoring', file, 'because of path');
        continue;
      }
      const doc = await openFile(file, this.projectPath);

      await forEveryFile(file, doc);
    }
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
