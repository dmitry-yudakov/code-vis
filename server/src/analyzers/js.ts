import {
  FileIncludeInfo,
  FunctionCallInfo,
  FileMapping,
  FunctionDeclarationInfo,
} from './../types';
import path from 'path';
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

const _commonCompletionSuffixes = [
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.d.ts',
  '/index.js',
  '/index.ts',
  '/index.jsx',
  '/index.tsx',
];

export const tryAutoResolveProjectModule = (
  incompleteFilename: string,
  projectFiles: string[]
): string | null => {
  if (path.extname(incompleteFilename)) return null; // already complete

  for (let completeFilename of projectFiles) {
    if (completeFilename.length - incompleteFilename.length < 3) continue; // too short

    // could be useful to autodetect extension or dangerous, disabled it for the moment...
    // const ext = path.extname(completeFilename);
    // if (completeFilename === incompleteFilename + ext) {
    //   console.log('AutoResolved', incompleteFilename, 'to', completeFilename);
    //   return completeFilename;
    // }

    for (const suffix of _commonCompletionSuffixes) {
      if (completeFilename === incompleteFilename + suffix) {
        console.log('AutoResolved', incompleteFilename, 'to', completeFilename);

        return completeFilename;
      }
    }
  }
  console.log('Could not AutoResolve', incompleteFilename);
  return null;
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

  includes.forEach((info) => {
    info.from = tryAutoResolveProjectModule(info.from, filenames) || info.from;
  });

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
      const leadingTriviaWidth = node.getLeadingTriviaWidth?.() || 0;
      return {
        name: node.name.escapedText,
        filename,
        pos: node.pos + leadingTriviaWidth,
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
      if (node.parent.kind === SyntaxKind.CallExpression) return false; // arrow function passed as argument
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
      const leadingTriviaWidth =
        furthestRelevantParentNode.getLeadingTriviaWidth?.() || 0;
      // console.log({
      //   isSoleDeclaration,
      //   leadingTriviaWidth,
      //   furthestRelevantParentNode,
      // });
      return {
        name: node.parent.name.escapedText,
        filename,
        pos: furthestRelevantParentNode.pos + leadingTriviaWidth,
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
      const leadingTriviaWidth = node.getLeadingTriviaWidth?.() || 0;
      return {
        name: node.name.escapedText,
        filename,
        pos: node.pos + leadingTriviaWidth,
        end: node.end,
        args: node.parameters.map((p: any) => {
          // console.log('Func argument:', p);
          return p.name.escapedText;
        }),
      };
    });

  return [...funcs, ...arrowFuncs, ...methods].sort((l, r) => l.pos - r.pos);
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
    true,
    ts.ScriptKind.TSX // should be the worst case
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
