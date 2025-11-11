import {
  FileIncludeInfo,
  FunctionCallInfo,
  FileMapping,
  FunctionDeclarationInfo,
} from './../types';
import path from 'path';
import ts, { CallExpression, SyntaxKind } from 'typescript';

const parseFile = (filename: string, content: string) =>
  ts.createSourceFile(
    filename,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX // should be the worst case
  );

// strip 'parent'
function pp(obj: any) {
  const { parent, ...rest } = obj;
  return rest;
}

const extractIncludes = (
  filename: string,
  content: string,
  sourceFile: ts.SourceFile
) => {
  const imports = searchFor(sourceFile.statements, SyntaxKind.ImportDeclaration)
    .filter((node) => {
      // console.log('Import node', node);
      if (!node.importClause) return false;
      if (node.moduleSpecifier?.text?.[0] === '.') return true;
      // console.log('Ignore non-local import', pp(node));
      console.log('Ignore non-local import from', node.moduleSpecifier?.text);
    })
    .map((node) => {
      const from = node.moduleSpecifier?.text as string;
      if (!from) {
        console.log('Unable to extract module name from', filename, pp(node));
        throw new Error('Unable to export module name from import');
      }
      // console.log('Import from', from);
      const name = node.importClause?.name?.escapedText;
      // console.log('Import name', name);
      const items: string[] = [];
      if (typeof name === 'string') {
        items.push(name);
      }

      const namespaceName = node.importClause?.namedBindings?.name?.escapedText;
      if (namespaceName) {
        items.push(namespaceName);
      }

      const namedBindings = node.importClause?.namedBindings?.elements
        ?.map((b: any) => {
          const name = b.name?.escapedText;
          if (!name) {
            console.log('Error getting import named binding', b);
            return null;
          }
          return name;
        })
        .map((nb: string | null) => nb || 'n/a');

      if (namedBindings) {
        namedBindings.forEach((nb: any) => items.push(nb));
      }

      if (!items.length) {
        console.log('Unsupported import:', pp(node));
        return null;
      }
      return {
        items,
        from,
        to: filename,
      };
    })
    .filter((incl) => !!incl) as FileIncludeInfo[];

  const requires = searchFor(sourceFile.statements, SyntaxKind.CallExpression)
    .filter((node) => {
      if (
        node.expression?.escapedText === 'require' &&
        node.parent?.kind === SyntaxKind.VariableDeclaration &&
        node.arguments?.[0]?.kind === SyntaxKind.StringLiteral &&
        node.arguments[0].text?.[0] === '.'
      )
        return true;
    })
    .map((node) => {
      // console.log('Require node', pp(node));

      const from = node.arguments?.[0]?.text;
      if (!from) {
        console.log('Unable to extract module name from', filename, pp(node));
        throw new Error('Unable to export module name from require');
      }

      const items: string[] = [];
      const name = node.parent.name?.escapedText;
      if (name) {
        items.push(name);
      }
      const nameElements = node.parent.name?.elements;
      nameElements?.forEach((el: any) => {
        const name = el.name?.escapedText;
        if (typeof name !== 'string') {
          console.log('Cannot resolve require element name', el, nameElements);
          return;
        }
        items.push(name);
      });

      if (!items.length) {
        console.log('Cannot resolve require items', pp(node.parent));
      }

      return {
        from,
        to: filename,
        items,
      };
    });

  const includes: FileIncludeInfo[] = imports.concat(requires);

  includes.forEach(resolveRelativeIncludePathInPlace);

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
      const sourceFile = parseFile(filename, content);
      return extractIncludes(filename, content, sourceFile);
    })
  ).then((nestedIncludes) => nestedIncludes.flat());

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
  if (_path.length > 300) {
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

      const leadingTriviaWidth = node.getLeadingTriviaWidth?.() || 0;

      return {
        name,
        args,
        pos: node.pos + leadingTriviaWidth,
        end: node.end,
        filename,
      };
    });

  return calls;
};

const extractFileMapping = (
  filename: string,
  content: string,
  projectFilenames: string[] = []
): FileMapping => {
  const sourceFile = parseFile(filename, content);

  const includes = extractIncludes(filename, content, sourceFile);

  includes.forEach((info) => {
    info.from =
      tryAutoResolveProjectModule(info.from, projectFilenames) || info.from;
  });

  const functionDeclarations: FunctionDeclarationInfo[] = extractFunctionDeclarations(
    filename,
    sourceFile
  );

  const functionCalls: FunctionCallInfo[] = extractFunctionCalls(
    filename,
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
