// Minimal static file server for the built app (dist/). Used for Railway/Render/Node hosting.
//
// Runtime config: the Google Maps Platform key can be supplied as a Railway (or any host)
// environment variable named GOOGLE_MAPS_API_KEY (VITE_GOOGLE_MAPS_API_KEY also accepted).
// We inject it into index.html at request time as window.__RUNTIME_CONFIG__ so the key can be
// set/rotated purely through the hosting dashboard — no rebuild and no in-app entry required.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const PORT = process.env.PORT || 3000;
const GMAPS_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '';
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary', '.ico': 'image/x-icon',
};

/** Inject the runtime config script into the served HTML <head>. */
function injectConfig(html) {
  const cfg = JSON.stringify({ GOOGLE_MAPS_API_KEY: GMAPS_KEY });
  const tag = `<script>window.__RUNTIME_CONFIG__=${cfg};</script>`;
  return html.includes('</head>') ? html.replace('</head>', `${tag}</head>`) : tag + html;
}

createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    let filePath = normalize(join(root, urlPath));
    if (!filePath.startsWith(root)) { res.writeHead(403).end('Forbidden'); return; }
    let data, isHtml = extname(filePath) === '.html';
    try { data = await readFile(filePath); }
    catch { filePath = join(root, 'index.html'); isHtml = true; data = await readFile(filePath); } // SPA fallback
    if (isHtml) data = Buffer.from(injectConfig(data.toString('utf8')));
    res.writeHead(200, { 'Content-Type': TYPES[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(500).end('Server error');
  }
}).listen(PORT, () => console.log(`DroneOps serving dist/ on :${PORT}${GMAPS_KEY ? ' (Maps key from env)' : ''}`));
