export interface FileIncludeInfo {
  to: string;
  from: string;
  items: string[];
}

export interface FunctionCallInfo {
  name: string;
  filename: string;
  pos: number;
  end: number;
  args: string[];
  calleeText?: string;
  callChain?: string[];
  callKind?: 'call' | 'constructor' | 'jsx-component' | 'tagged-template';
  receiverText?: string;
  receiverKind?:
    | 'identifier'
    | 'property'
    | 'element-access'
    | 'call-result'
    | 'unknown';
  isOptional?: boolean;
  isBuiltin?: boolean;
}
export interface FunctionDeclarationInfo {
  name: string;
  filename: string;
  pos: number;
  end: number;
  args: string[];
}
export interface FileMapping {
  includes: FileIncludeInfo[];
  functionDeclarations: FunctionDeclarationInfo[];
  functionCalls: FunctionCallInfo[];
}

export interface FileMapDetailed {
  content: string;
  mapping: FileMapping;
}

export interface Edge {
  source: string;
  target: string;
}
export interface Node {
  id: string;
  label: string;
}
export interface PositionedNode extends Node {
  x: number;
  y: number;
}
