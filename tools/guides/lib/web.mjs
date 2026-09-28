// The client, served by Vite on the guide's own port with /api sent to the
// guide's own API server — so a recording never touches, or is touched by, a
// dev server somebody already has running. The client's vite.config.js is
// still read; only the port and the proxy target are changed.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const client = path.resolve(here, '../../../client');
const vitePath = createRequire(path.join(client, 'package.json')).resolve('vite');
const { createServer } = await import(pathToFileURL(vitePath).href);

const port = Number(process.env.GUIDE_WEB_PORT);
const target = `http://localhost:${process.env.GUIDE_API_PORT}`;

const server = await createServer({
  root: client,
  configFile: path.join(client, 'vite.config.js'),
  logLevel: 'warn',
  server: { port, strictPort: true, proxy: { '/api': { target, changeOrigin: true } } },
});
await server.listen();
console.log(`[web] client on http://localhost:${port}, API at ${target}`);
