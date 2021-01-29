export type TScanFileCallback = (relativePath: string, content: string) => void;

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

export interface ProjectConfig {
  includeMask: string;
  excludeMask?: string | string[];
}

export interface ProjectChangeEvent {
  type: 'add' | 'change' | 'remove';
  path: string;
}
