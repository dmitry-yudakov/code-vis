import { getProjectFiles, openFile } from './io';
import { FileMapping, FunctionCallInfo, ProjectConfig } from './types';
import { getAnalyzer } from './analyzers';

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

  processCommand = async (type: string, payload: any | undefined) => {
    // let tokens = type.split(' ').filter((word) => word);
    console.log('Process command', { type, payload });

    switch (type) {
      case 'mapProject':
        return this.projectMap();
      case 'mapFile':
        return this.fileMap(payload.filename, payload.includeRelated);
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
    const analyzer = getAnalyzer('js'); // temp
    // TODO check should ignore
    const data = await analyzer.extractFilesHierarchy(this.files, (fn) =>
      openFile(fn, this.projectPath)
    );
    // console.log(data);
    return { type: 'projectMap', payload: data };
  }

  async fileMap(filename: string, includeRelated = false) {
    console.log('fileMap command', { filename, includeRelated });
    const analyzer = getAnalyzer('js'); // temp
    const content = await openFile(filename, this.projectPath);

    if (!content) throw new Error('File not found');

    const mapping: FileMapping = analyzer.extractFileMapping(
      filename,
      content,
      this.files
    );
    const payload = [{ content, mapping, filename }];

    if (includeRelated) {
      for (const fnm of mapping.includes.map((ii) => ii.from)) {
        const cont = await openFile(fnm, this.projectPath);
        const mpng = analyzer.extractFileMapping(fnm, cont, this.files);

        payload.push({ content: cont, mapping: mpng, filename: fnm });
      }
    }

    return {
      type: 'fileMap',
      payload,
    };
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
