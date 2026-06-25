// Minimal static file server for the built app (dist/). Used for Railway/Render/Node hosting.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const PORT = process.env.PORT || 3000;
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary', '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    let filePath = normalize(join(root, urlPath));
    if (!filePath.startsWith(root)) { res.writeHead(403).end('Forbidden'); return; }
    let data;
    try { data = await readFile(filePath); }
    catch { filePath = join(root, 'index.html'); data = await readFile(filePath); } // SPA fallback
    res.writeHead(200, { 'Content-Type': TYPES[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(500).end('Server error');
  }
}).listen(PORT, () => console.log(`DroneOps serving dist/ on :${PORT}`));
