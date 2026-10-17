import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/style.css': ['style.css', 'text/css'], '/workflow.js': ['workflow.js', 'text/javascript'], '/mark.svg': ['mark.svg', 'image/svg+xml'] };
export function preview(port = 4173) {
  const server = createServer(async (req, res) => {
    let pathname;
    try { pathname = new URL(req.url, 'http://127.0.0.1').pathname; }
    catch { res.writeHead(400).end('Invalid request target'); return; }
    const file = Object.hasOwn(files, pathname) ? files[pathname] : undefined;
    if (!file || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404).end(); return; }
    try {
      const body = await readFile(new URL(file[0], import.meta.url));
      res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(500).end('Preview file unavailable'); }
  });
  server.listen(port, '127.0.0.1');
  return server;
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  preview().on('listening', () => console.log('CodeAI preview: http://127.0.0.1:4173 (Ctrl+C to stop)'));
}
