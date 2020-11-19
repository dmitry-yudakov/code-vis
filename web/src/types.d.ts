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
