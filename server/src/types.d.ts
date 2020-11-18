export type TScanFileCallback = (relativePath: string, content: string) => void;

export interface IFileIncludeInfo {
  to: string;
  from: string;
  items: string[];
}
export interface IFunctionCallInfo {
  name: string;
  from: string;
  args: string[];
}

export interface ProjectConfig {
  includeMask: string;
  excludeMask?: string | string[];
}
