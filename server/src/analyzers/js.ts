import {
  FileIncludeInfo,
  FunctionCallInfo,
  FileMapping,
  FunctionDeclarationInfo,
} from './../types';
import ts, { CallExpression, SyntaxKind } from 'typescript';

const extractIncludes = (relativePath: string, content: string) => {
  const includes: FileIncludeInfo[] = [];
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

const resolveRelativeIncludePathInPlace = (info: FileIncludeInfo): void => {
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
  info: FileIncludeInfo,
  projectFiles: string[]
): void => {
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
): Promise<FileIncludeInfo[]> => {
  const includes: FileIncludeInfo[] = await Promise.all(
    filenames.map(async (filename) => {
      const content = await getFileContent(filename);
      return extractIncludes(filename, content);
    })
  ).then((nestedIncludes) => nestedIncludes.flat());

  includes.forEach(resolveRelativeIncludePathInPlace);

  includes.forEach((info) => autoAppendJSextensionInPlace(info, filenames));

  return includes;
};

const searchFor = (
  tree: any,
  kind: SyntaxKind,
  result?: any[],
  path?: string[]
) => {
  const _result = result || [];
  const _path = path || [];
  if (_path.length > 100) {
    console.log('Too long path in searching:', _path);
    throw new Error('Too long path');
  }
  if (Array.isArray(tree)) {
    for (const val of tree) {
      searchFor(val, kind, _result, [..._path, 'ARR']);
    }
  } else if (typeof tree === 'object') {
    if (tree.kind === kind) {
      _result.push(tree);
      // return;
    }
    for (const [key, val] of Object.entries(tree)) {
      if (key === 'parent' || key === 'parseDiagnostics') continue;
      // console.log('analize obj prop', key);
      searchFor(val, kind, _result, [..._path, key]);
    }
  }
  return _result;
};

const extractFunctionDeclarations = (
  filename: string,
  sourceFile: ts.SourceFile
): FunctionDeclarationInfo[] => {
  const funcs = searchFor(sourceFile, SyntaxKind.FunctionDeclaration).map(
    (node) => {
      return {
        name: node.name.escapedText,
        filename,
        pos: node.pos,
        end: node.end,
        args: node.parameters.map((p: any) => {
          // console.log('Func argument:', p);
          return p.name.escapedText;
        }),
      };
    }
  );

  const arrowFuncs = searchFor(sourceFile, SyntaxKind.ArrowFunction)
    .filter((node) => {
      // console.log('Arrow node', node);
      // console.log('Arrow node parent', node.parent);
      if (node.parent?.name?.escapedText) return true;
      console.log('Unexpected arrow func declaration:', node);
    })
    .map((node) => {
      // try to get 'const ...;' parts in pos-end too.
      // sometimes impossible -> const a=()=>{}, b=()=>{};
      // usually it's sole declaration: const a = () => {}
      const isSoleDeclaration =
        node.parent.kind === SyntaxKind.VariableDeclaration &&
        node.parent.parent.kind === SyntaxKind.VariableDeclarationList &&
        node.parent.parent.declarations.length === 1 &&
        node.parent.parent.parent.kind === SyntaxKind.VariableStatement;
      const furthestRelevantParentNode = isSoleDeclaration
        ? node.parent.parent.parent
        : node.parent;
      // console.log({ isSoleDeclaration, furthestRelevantParentNode });
      return {
        name: node.parent.name.escapedText,
        filename,
        pos: furthestRelevantParentNode.pos,
        end: furthestRelevantParentNode.end,
        args: node.parameters.map((p: any) => {
          // console.log('Func argument:', p);
          return p.name.escapedText;
        }),
      };
    });

  const methods = searchFor(sourceFile, SyntaxKind.MethodDeclaration)
    .filter((node) => {
      // console.log('Arrow node', node);
      // console.log('Arrow node parent', node.parent);
      if (node.parent?.name?.escapedText) return true;
      console.log('Unexpected method declaration:', node);
    })
    .map((node) => {
      return {
        name: node.name.escapedText,
        filename,
        pos: node.pos,
        end: node.end,
        args: node.parameters.map((p: any) => {
          // console.log('Func argument:', p);
          return p.name.escapedText;
        }),
      };
    });

  return [...funcs, ...arrowFuncs, ...methods];
};

const extractFunctionCalls = (
  filename: string,
  sourceFile: ts.SourceFile
): FunctionCallInfo[] => {
  const calls = searchFor(sourceFile, SyntaxKind.CallExpression)
    .filter((node: any) => {
      if (!!node.arguments && !!node.expression?.escapedText) return true;
      if (!!node.arguments && !!node.expression?.name?.escapedText) return true;
      if (node.expression?.kind === SyntaxKind.SuperKeyword) return false;
      console.log('Unexpected CallExpression:', node);
    })
    .map((node: any) => {
      const name =
        node.expression.escapedText || node.expression?.name?.escapedText;
      const args = node.arguments.map((arg: any) => {
        // console.log('Arg', arg);
        // console.log('Arg expr', arg.expression);
        return arg.text || `EXPR:${arg.expression?.escapedText}...` || 'n/a';
      });

      return {
        name,
        args,
        pos: node.pos,
        end: node.end,
        filename,
      };
    });

  return calls;
};

const extractFileMapping = (
  relativePath: string,
  content: string
): FileMapping => {
  const sourceFile = ts.createSourceFile(
    relativePath,
    content,
    ts.ScriptTarget.Latest,
    true
  );
  // console.log(sourceFile);

  const includes = extractIncludes(relativePath, content);

  const functionDeclarations: FunctionDeclarationInfo[] = extractFunctionDeclarations(
    relativePath,
    sourceFile
  );

  const functionCalls: FunctionCallInfo[] = extractFunctionCalls(
    relativePath,
    sourceFile
  );

  const res = { functionDeclarations, includes, functionCalls };
  // console.log('res', JSON.stringify(res, null, 2));
  return res;
};

export default {
  extractFilesHierarchy,
  extractFileMapping,
};
