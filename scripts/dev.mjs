import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

await import(pathToFileURL(resolve(import.meta.dirname, 'build.mjs')).href);
const root = resolve(import.meta.dirname, '..', 'dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  let file = join(root, pathname.replace(/^\/+/, ''));
  if (pathname === '/' || pathname.startsWith('/room/')) file = join(root, 'index.html');
  try {
    if (!(await stat(file)).isFile()) throw new Error('Not a file');
    response.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.statusCode = 404; response.end('Not found'); }
});
server.listen(3000, () => console.log('Open http://localhost:3000'));
