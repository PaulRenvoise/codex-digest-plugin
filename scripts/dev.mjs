import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createWorker } from '../src/worker.mjs';
import { localDatabase } from './sqlite-d1.mjs';

const worker = createWorker(await readFile(new URL('../ui/index.html', import.meta.url), 'utf8'));
const db = localDatabase(process.env.DIGEST_DEV_DB || ':memory:');
const port = Number(process.env.PORT || 4318);
const server = createServer(async (incoming, outgoing) => {
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
    // The loopback-only preview always overwrites caller-supplied identity.
    headers.set('oai-authenticated-user-id', 'local-preview');
    const request = new Request(`http://127.0.0.1:${port}${incoming.url}`, { method: incoming.method, headers,
      ...(incoming.method !== 'GET' && incoming.method !== 'HEAD' ? { body: incoming, duplex: 'half' } : {}) });
    const response = await worker.fetch(request, { DB: db });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500); outgoing.end('Preview request failed.'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Digest local preview: http://127.0.0.1:${port} (development identity; never expose publicly)`));
process.on('SIGINT', () => server.close(() => { db.close(); process.exit(0); }));
