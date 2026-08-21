import type { DrawingMark } from '@/shared/types';

function escape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function marksToSvg(marks: DrawingMark[]): string {
  return marks.map((mark) => {
    if (mark.kind === 'pen') {
      const points = mark.points.map((point) => `${point.x},${point.y}`).join(' ');
      return `<polyline points="${points}" fill="none" stroke="${mark.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    if (mark.kind === 'rectangle') {
      return `<rect x="${mark.x}" y="${mark.y}" width="${mark.width}" height="${mark.height}" fill="none" stroke="${mark.color}" stroke-width="3" rx="5"/>`;
    }
    if (mark.kind === 'arrow') {
      const angle = Math.atan2(mark.end.y - mark.start.y, mark.end.x - mark.start.x);
      const size = 12;
      const a = { x: mark.end.x - size * Math.cos(angle - Math.PI / 6), y: mark.end.y - size * Math.sin(angle - Math.PI / 6) };
      const b = { x: mark.end.x - size * Math.cos(angle + Math.PI / 6), y: mark.end.y - size * Math.sin(angle + Math.PI / 6) };
      return `<path d="M ${mark.start.x} ${mark.start.y} L ${mark.end.x} ${mark.end.y} M ${a.x} ${a.y} L ${mark.end.x} ${mark.end.y} L ${b.x} ${b.y}" fill="none" stroke="${mark.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    return `<text x="${mark.x}" y="${mark.y}" fill="${mark.color}" font-family="sans-serif" font-size="18" font-weight="600">${escape(mark.text)}</text>`;
  }).join('');
}

export async function compositePng(svgMarkup: string, marks: DrawingMark[], viewBox: [number, number, number, number]): Promise<string> {
  const documentSvg = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml').documentElement;
  documentSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  documentSvg.setAttribute('viewBox', viewBox.join(' '));
  documentSvg.setAttribute('width', String(Math.min(4096, Math.max(1, viewBox[2]))));
  documentSvg.setAttribute('height', String(Math.min(4096, Math.max(1, viewBox[3]))));
  const overlay = documentSvg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
  overlay.innerHTML = marksToSvg(marks);
  documentSvg.append(overlay);
  const serialized = new XMLSerializer().serializeToString(documentSvg);
  const url = URL.createObjectURL(new Blob([serialized], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.decoding = 'sync';
    image.src = url;
    await image.decode();
    const scale = Math.min(2, 4096 / Math.max(viewBox[2], viewBox[3]), 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewBox[2] * scale));
    canvas.height = Math.max(1, Math.round(viewBox[3] * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas export is unavailable.');
    context.fillStyle = '#fffdf8';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}
