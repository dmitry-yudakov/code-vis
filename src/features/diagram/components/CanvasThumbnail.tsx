'use client';

import { useEffect, useRef, useState } from 'react';
import type { ThemeName } from '@/shared/design/tokens';
import type { DiagramArtifact, DrawingMark, SketchCanvas } from '@/shared/types';
import { marksToSvg } from '@/features/diagram/annotations/compositeExport';
import { renderMermaid } from '@/features/diagram/mermaid/mermaidRenderer';

// Rendered diagrams by artifact and theme. Artifacts are immutable, so an entry never goes stale;
// the bound only keeps a long-lived tab from holding every diagram it has ever listed.
const MAX_RENDERED = 80;
const rendered = new Map<string, string>();

function remember(key: string, svg: string) {
  rendered.delete(key);
  rendered.set(key, svg);
  for (const oldest of rendered.keys()) {
    if (rendered.size <= MAX_RENDERED) break;
    rendered.delete(oldest);
  }
}

/**
 * A small picture of one canvas for the History list. A sketch is its marks. A diagram is rendered
 * by Mermaid, which the renderer already runs one at a time; this waits until the entry is scrolled
 * into view, so opening a long history costs only what is looked at.
 */
export function CanvasThumbnail({ artifact, sketch, marks, theme, fallback }: {
  artifact?: DiagramArtifact;
  sketch?: SketchCanvas;
  marks: DrawingMark[];
  theme: ThemeName;
  fallback: string;
}) {
  const frame = useRef<HTMLSpanElement>(null);
  const [inView, setInView] = useState(false);
  const [svg, setSvg] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const node = frame.current;
    if (!node || inView) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setInView(true);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView]);

  useEffect(() => {
    if (!artifact || !inView) return;
    setFailed(artifact.status !== 'ready');
    if (artifact.status !== 'ready') return;
    const key = `${artifact.id}:${theme}`;
    const cached = rendered.get(key);
    setSvg(cached);
    if (cached) return;
    let current = true;
    void renderMermaid(`thumb-${artifact.id.replaceAll('-', '')}`, artifact.source, theme).then((result) => {
      remember(key, result.svg);
      if (current) setSvg(result.svg);
    }).catch(() => {
      if (current) setFailed(true);
    });
    return () => { current = false; };
  }, [artifact, inView, theme]);

  return (
    <span className="canvas-thumbnail" ref={frame} aria-hidden="true">
      {sketch
        ? <svg viewBox={sketch.viewBox.join(' ')} dangerouslySetInnerHTML={{ __html: marksToSvg(marks) }} />
        : svg && !failed
          ? <span data-mermaid-theme={theme} dangerouslySetInnerHTML={{ __html: svg }} />
          : <span className="canvas-thumbnail-mark">{fallback}</span>}
    </span>
  );
}
