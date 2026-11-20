'use client';

import { useEffect, useState, type ComponentProps } from 'react';
import type { ExtraProps } from 'react-markdown';
import { validateMermaidSource } from '@/features/diagram/mermaid/mermaidPolicy';
import { renderMermaid } from '@/features/diagram/mermaid/mermaidRenderer';
import { useTheme } from '@/features/shell/useTheme';
import type { ThemeName } from '@/shared/design/tokens';
import { createUuid } from '@/shared/uuid';

function MermaidPreview({ source }: { source: string }) {
  const { resolved: theme } = useTheme();
  const [rendered, setRendered] = useState<{ source: string; theme: ThemeName; svg?: string; error?: string }>();
  const { svg, error } = rendered?.source === source && rendered.theme === theme ? rendered : {};

  useEffect(() => {
    let current = true;
    const policy = validateMermaidSource(source);
    if (!policy.ok) {
      setRendered({ source, theme, error: policy.error });
      return;
    }
    // A fresh ID also keeps theme rerenders from touching an SVG still displayed in another tab.
    void renderMermaid(`markdown-${createUuid()}`, source, theme).then(result => {
      if (current) setRendered({ source, theme, svg: result.svg });
    }).catch((reason: unknown) => {
      if (current) setRendered({ source, theme, error: reason instanceof Error ? reason.message.split('\n')[0].slice(0, 200) : 'Render failed.' });
    });
    return () => { current = false; };
  }, [source, theme]);

  return <div className="markdown-mermaid">
    {svg ? <div className="markdown-mermaid-svg" role="img" aria-label="Mermaid diagram"
      data-mermaid-theme={theme} dangerouslySetInnerHTML={{ __html: svg }} />
      : <>
        <p role="status">{error ? `Diagram unavailable: ${error}` : 'Rendering diagram…'}</p>
        {error && <pre><code className="language-mermaid">{source}</code></pre>}
      </>}
  </div>;
}

/** Replace only fenced Mermaid blocks; inline and ordinary fenced code keep Markdown's markup. */
export function MarkdownPreviewCodeBlock({ node, children, ...props }: ComponentProps<'pre'> & ExtraProps) {
  const code = node?.children.length === 1 ? node.children[0] : undefined;
  if (code?.type === 'element' && code.tagName === 'code'
    && Array.isArray(code.properties.className) && code.properties.className.includes('language-mermaid')) {
    const source = code.children.map(child => child.type === 'text' ? child.value : '').join('');
    return <MermaidPreview source={source} />;
  }
  return <pre {...props}>{children}</pre>;
}
