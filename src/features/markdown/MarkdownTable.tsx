import type { ComponentProps } from 'react';
import type { ExtraProps } from 'react-markdown';

export function MarkdownTable({ node, ...props }: ComponentProps<'table'> & ExtraProps) {
  return <div className="markdown-table-scroll" role="region" aria-label="Markdown table" tabIndex={0}>
    <table {...props} />
  </div>;
}
