// ============================================================
// CHAOSBEY DESKTOP (LOCAL TEST BUILD) — ELECTRON MAIN PROCESS
//
// This is a thin packaging shell around the real game: it serves the
// actual production web build (dist/, built by `vite build`, the exact
// same output GitHub Pages serves) from a local-only HTTP server and
// opens it in a plain browser window. No game logic lives here, and
// nothing here is reachable from the web content (contextIsolation,
// no nodeIntegration, no preload) — this file's only job is "find a free
// local port, serve dist/ under the same /ChaosBey/ base path the real
// site uses, open a window pointed at it".
//
// Deliberately not included: auto-update, telemetry, login, a menu bar,
// or any other desktop-app infrastructure the task didn't ask for.
// ============================================================

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');

// Must match vite.config.ts's GITHUB_PAGES_BASE — the production build's
// asset URLs are baked in under this path, exactly like GitHub Pages serves
// them, so this window sees the same thing https://<owner>.github.io/ChaosBey/
// does.
const BASE_PATH = '/ChaosBey/';
const DIST_DIR = path.join(__dirname, '..', 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  if (urlPath === '/') {
    res.writeHead(302, { Location: BASE_PATH });
    res.end();
    return;
  }
  if (!urlPath.startsWith(BASE_PATH)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const relative = urlPath.slice(BASE_PATH.length) || 'index.html';
  const filePath = path.join(DIST_DIR, relative);
  // dist/ is the only thing this server ever reads from — refuse anything
  // a crafted request path tried to walk outside of it.
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

let server = null;
let mainWindow = null;

function startServerAndWindow() {
  server = http.createServer(serveStatic);
  // 127.0.0.1 only — this server exists purely so the packaged production
  // build's absolute /ChaosBey/... asset URLs resolve the same way they do
  // on GitHub Pages; it is never meant to be reachable from the network.
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      title: 'ChaosBey (Local Test Build)',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    mainWindow.loadURL(`http://127.0.0.1:${port}${BASE_PATH}`);
  });
}

app.whenReady().then(startServerAndWindow);

app.on('window-all-closed', () => {
  if (server) server.close();
  app.quit();
});
