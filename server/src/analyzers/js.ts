import {
  FileIncludeInfo,
  FunctionCallInfo,
  FileMapping,
  FunctionDeclarationInfo,
} from './../types';
import path from 'path';
import ts, { SyntaxKind } from 'typescript';

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

  const visit = (node: ts.Node) => {
    if (node.kind === kind) {
      _result.push(node);
    }

    ts.forEachChild(node, visit);
  };

  if (Array.isArray(tree)) {
    for (const val of tree) {
      if (val && typeof val.kind === 'number') {
        visit(val as ts.Node);
      }
    }
  } else if (tree && typeof tree.kind === 'number') {
    visit(tree as ts.Node);
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

type ReceiverKind =
  | 'identifier'
  | 'property'
  | 'element-access'
  | 'call-result'
  | 'unknown';

interface ResolvedCalleeInfo {
  name: string;
  calleeText?: string;
  callChain?: string[];
  receiverText?: string;
  receiverKind?: ReceiverKind;
  isOptional?: boolean;
}

const BUILTIN_CONSTRUCTOR_NAMES = new Set([
  'Array',
  'ArrayBuffer',
  'BigInt',
  'Boolean',
  'DataView',
  'Date',
  'Error',
  'EvalError',
  'Float32Array',
  'Float64Array',
  'Function',
  'Int8Array',
  'Int16Array',
  'Int32Array',
  'Map',
  'Number',
  'Object',
  'Promise',
  'RangeError',
  'ReferenceError',
  'RegExp',
  'Set',
  'String',
  'SyntaxError',
  'TypeError',
  'Uint8Array',
  'Uint8ClampedArray',
  'Uint16Array',
  'Uint32Array',
  'URIError',
  'WeakMap',
  'WeakSet',
]);

const unwrapParenthesizedExpression = (expression: ts.Expression) => {
  let current: ts.Expression = expression;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
};

const normalizeNodeText = (node: ts.Node, sourceFile: ts.SourceFile): string =>
  node.getText(sourceFile).replace(/\s+/g, ' ').trim();

const getMemberNameText = (name: ts.Node): string | null => {
  if (ts.isIdentifier(name as ts.Node)) {
    return (name as ts.Identifier).text;
  }
  const escapedText = (name as any)?.escapedText;
  if (typeof escapedText === 'string') {
    return escapedText;
  }
  const text = (name as any)?.getText?.();
  if (typeof text === 'string' && text.length > 0) {
    return text.replace(/^#/, '');
  }
  return null;
};

const extractSimplePropertyChain = (
  expression: ts.Expression
): string[] | null => {
  const expr = unwrapParenthesizedExpression(expression);
  if (ts.isIdentifier(expr)) {
    return [expr.text];
  }
  if (expr.kind === SyntaxKind.ThisKeyword) {
    return ['this'];
  }
  if (ts.isPropertyAccessExpression(expr)) {
    const left = extractSimplePropertyChain(expr.expression);
    const right = getMemberNameText(expr.name);
    if (!left || !right) {
      return null;
    }
    return left.concat(right);
  }
  return null;
};

const inferReceiverKind = (expression: ts.Expression): ReceiverKind => {
  const expr = unwrapParenthesizedExpression(expression);
  if (ts.isIdentifier(expr) || expr.kind === SyntaxKind.ThisKeyword) {
    return 'identifier';
  }
  if (ts.isPropertyAccessExpression(expr)) {
    const chain = extractSimplePropertyChain(expr);
    if (chain) {
      return chain.length > 1 ? 'property' : 'identifier';
    }
    return 'unknown';
  }
  if (ts.isElementAccessExpression(expr)) {
    return 'element-access';
  }
  if (
    ts.isCallExpression(expr) ||
    ts.isNewExpression(expr) ||
    ts.isTaggedTemplateExpression(expr)
  ) {
    return 'call-result';
  }
  return 'unknown';
};

const isExpressionOptional = (expression: ts.Expression): boolean => {
  const expr = unwrapParenthesizedExpression(expression);
  if ((expr as any)?.questionDotToken) {
    return true;
  }
  if (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) {
    return isExpressionOptional(expr.expression);
  }
  if (ts.isCallExpression(expr)) {
    return isExpressionOptional(expr.expression);
  }
  return false;
};

const extractElementAccessTerminalName = (
  expression: ts.ElementAccessExpression
): string | null => {
  const arg = expression.argumentExpression;
  if (!arg) {
    return null;
  }
  if (ts.isStringLiteralLike(arg)) {
    return arg.text;
  }
  return null;
};

const resolveCallee = (
  expression: ts.Expression,
  sourceFile: ts.SourceFile
): ResolvedCalleeInfo => {
  const expr = unwrapParenthesizedExpression(expression);

  if (ts.isIdentifier(expr)) {
    return {
      name: expr.text,
      isOptional: isExpressionOptional(expression),
    };
  }

  if (ts.isPropertyAccessExpression(expr)) {
    const name = getMemberNameText(expr.name) || '[unknown]';
    const receiverKind = inferReceiverKind(expr.expression);
    const receiverChain = extractSimplePropertyChain(expr.expression);
    const calleeChain = extractSimplePropertyChain(expr);

    const callee: ResolvedCalleeInfo = {
      name,
      receiverKind,
      isOptional: isExpressionOptional(expression),
    };

    if (receiverChain && receiverChain.length > 0) {
      callee.receiverText = receiverChain.join('.');
    } else if (receiverKind === 'element-access') {
      callee.receiverText = normalizeNodeText(expr.expression, sourceFile);
    }

    if (receiverKind !== 'call-result') {
      if (calleeChain && calleeChain.length > 1) {
        callee.callChain = calleeChain;
        callee.calleeText = calleeChain.join('.');
      } else {
        callee.calleeText = normalizeNodeText(expr, sourceFile);
      }
    }

    return callee;
  }

  if (ts.isElementAccessExpression(expr)) {
    const terminalName = extractElementAccessTerminalName(expr);
    return {
      name: terminalName || '[element-access]',
      calleeText: normalizeNodeText(expr, sourceFile),
      receiverText: normalizeNodeText(expr.expression, sourceFile),
      receiverKind: 'element-access',
      isOptional: isExpressionOptional(expression),
    };
  }

  if (
    ts.isCallExpression(expr) ||
    ts.isNewExpression(expr) ||
    ts.isTaggedTemplateExpression(expr)
  ) {
    return {
      name: '[call-result]',
      receiverKind: 'call-result',
      isOptional: isExpressionOptional(expression),
    };
  }

  if (expr.kind === SyntaxKind.ThisKeyword) {
    return {
      name: 'this',
      receiverKind: 'identifier',
      isOptional: isExpressionOptional(expression),
    };
  }

  return {
    name: normalizeNodeText(expr, sourceFile) || '[unknown]',
    receiverKind: 'unknown',
    isOptional: isExpressionOptional(expression),
  };
};

const extractExpressionArgs = (
  args: ts.NodeArray<ts.Expression> | undefined,
  sourceFile: ts.SourceFile
): string[] => {
  if (!args) {
    return [];
  }
  return args.map((arg) => {
    const argAny = arg as any;
    if (typeof argAny.text === 'string' || typeof argAny.text === 'number') {
      return String(argAny.text);
    }
    if (typeof argAny.expression?.escapedText === 'string') {
      return `EXPR:${argAny.expression.escapedText}...`;
    }
    if (ts.isIdentifier(arg)) {
      return arg.text;
    }
    return `EXPR:${normalizeNodeText(arg, sourceFile).slice(0, 40)}...`;
  });
};

const extractJsxArgs = (
  attributes: ts.JsxAttributes,
  sourceFile: ts.SourceFile
): string[] => {
  return attributes.properties.map((prop) => {
    if (ts.isJsxAttribute(prop)) {
      const attrName = prop.name.getText(sourceFile);
      const { initializer } = prop;
      if (!initializer) {
        return attrName;
      }
      if (ts.isStringLiteral(initializer)) {
        return `${attrName}=${initializer.text}`;
      }
      return `EXPR:${attrName}...`;
    }
    return `EXPR:${normalizeNodeText(prop.expression, sourceFile).slice(0, 40)}...`;
  });
};

const shouldIncludeJsxTag = (name: string): boolean => /^[A-Z]/.test(name);

const applyCalleeInfo = (
  callInfo: FunctionCallInfo,
  calleeInfo: ResolvedCalleeInfo
) => {
  if (calleeInfo.calleeText) {
    callInfo.calleeText = calleeInfo.calleeText;
  }
  if (calleeInfo.callChain && calleeInfo.callChain.length > 0) {
    callInfo.callChain = calleeInfo.callChain;
  }
  if (calleeInfo.receiverText) {
    callInfo.receiverText = calleeInfo.receiverText;
  }
  if (calleeInfo.receiverKind) {
    callInfo.receiverKind = calleeInfo.receiverKind;
  }
  if (calleeInfo.isOptional) {
    callInfo.isOptional = true;
  }
};

const extractFunctionCalls = (
  filename: string,
  sourceFile: ts.SourceFile
): FunctionCallInfo[] => {
  const callExpressions = searchFor(
    sourceFile,
    SyntaxKind.CallExpression
  ) as ts.CallExpression[];
  const callExpressionCalls = callExpressions
    .filter((node) => node.expression?.kind !== SyntaxKind.SuperKeyword)
    .map((node) => {
      const calleeInfo = resolveCallee(node.expression, sourceFile);
      const leadingTriviaWidth = node.getLeadingTriviaWidth?.() || 0;
      const info: FunctionCallInfo = {
        name: calleeInfo.name,
        args: extractExpressionArgs(node.arguments, sourceFile),
        pos: node.pos + leadingTriviaWidth,
        end: node.end,
        filename,
      };
      applyCalleeInfo(info, calleeInfo);
      return info;
    });

  const newExpressions = searchFor(
    sourceFile,
    SyntaxKind.NewExpression
  ) as ts.NewExpression[];
  const constructorCalls = newExpressions.map((node) => {
    const calleeInfo = resolveCallee(node.expression, sourceFile);
    const leadingTriviaWidth = node.getLeadingTriviaWidth?.() || 0;
    const info: FunctionCallInfo = {
      name: calleeInfo.name,
      args: extractExpressionArgs(node.arguments, sourceFile),
      pos: node.pos + leadingTriviaWidth,
      end: node.end,
      filename,
      callKind: 'constructor',
    };
    applyCalleeInfo(info, calleeInfo);
    if (BUILTIN_CONSTRUCTOR_NAMES.has(info.name)) {
      info.isBuiltin = true;
    }
    return info;
  });

  const taggedTemplates = searchFor(
    sourceFile,
    SyntaxKind.TaggedTemplateExpression
  ) as ts.TaggedTemplateExpression[];
  const taggedTemplateCalls = taggedTemplates.map((node) => {
    const calleeInfo = resolveCallee(node.tag, sourceFile);
    const leadingTriviaWidth = node.getLeadingTriviaWidth?.() || 0;
    const info: FunctionCallInfo = {
      name: calleeInfo.name,
      args: [],
      pos: node.pos + leadingTriviaWidth,
      end: node.end,
      filename,
      callKind: 'tagged-template',
    };
    applyCalleeInfo(info, calleeInfo);
    return info;
  });

  const jsxOpenings = searchFor(
    sourceFile,
    SyntaxKind.JsxOpeningElement
  ) as ts.JsxOpeningElement[];
  const jsxSelfClosings = searchFor(
    sourceFile,
    SyntaxKind.JsxSelfClosingElement
  ) as ts.JsxSelfClosingElement[];

  const jsxNodes: Array<ts.JsxOpeningElement | ts.JsxSelfClosingElement> = [
    ...jsxOpenings,
    ...jsxSelfClosings,
  ];

  const jsxCalls = jsxNodes
    .map((node) => {
      const tagName = node.tagName as ts.Node;
      const isSupportedTagName =
        ts.isIdentifier(tagName) ||
        ts.isPropertyAccessExpression(tagName) ||
        tagName.kind === SyntaxKind.ThisKeyword;
      if (!isSupportedTagName) {
        return null;
      }
      const calleeInfo = resolveCallee(
        node.tagName as unknown as ts.Expression,
        sourceFile
      );
      if (!shouldIncludeJsxTag(calleeInfo.name)) {
        return null;
      }

      const leadingTriviaWidth = node.getLeadingTriviaWidth?.() || 0;
      const info: FunctionCallInfo = {
        name: calleeInfo.name,
        args: extractJsxArgs(node.attributes, sourceFile),
        pos: node.pos + leadingTriviaWidth,
        end: node.end,
        filename,
        callKind: 'jsx-component',
      };
      applyCalleeInfo(info, calleeInfo);
      return info;
    })
    .filter((call): call is FunctionCallInfo => !!call);

  return callExpressionCalls
    .concat(constructorCalls)
    .concat(taggedTemplateCalls)
    .concat(jsxCalls)
    .sort((left, right) => left.pos - right.pos || left.end - right.end);
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

  const functionDeclarations: FunctionDeclarationInfo[] =
    extractFunctionDeclarations(filename, sourceFile);

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
