export interface Include {
  items: string[];
  to: string;
  from: string;
}

export interface FileMapping {
  content: string;
  mapping: {
    args: string[];
    name: string;
    from: string;
  };
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
