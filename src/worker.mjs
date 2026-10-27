import { VERSION, UI_URI, TOOLS, ICONS, DigestError, RESEARCH_GUIDELINES } from './contract.mjs';
import { DigestService } from './service.mjs';

export const SERVER_INSTRUCTIONS = `Digests stores personal digests, editions and feedback. ${RESEARCH_GUIDELINES}
Save verified items with save_edition, then open_digest. Never call save_feedback on behalf of the user; they vote in the app. A direct request may override items_per_edition for one edition.
Generate stable request keys and reuse them on retries. Create/update configuration only when requested. Saves never send conversation messages or edit cloud jobs. One shared Sites cloud task checks all digests hourly; do not create per-digest schedules. The backend computes next_run_at using each saved daily, weekly or monthly frequency, fixed UTC offset, and last-day clamping. Verify cloud read/write access before enabling the shared task, and check linked automations to avoid duplicates.
For each hourly run call list_due_digests once, then claim_digest_run for each returned digest with a fresh attempt request_key (reuse it only on retries). Skip run:null and already completed/skipped claims. Read all research context pages after claiming, use current settings, search and verify original sources, then save_edition with run_id, claim_token and request_key equal to run_id. Renew with renew_digest_run before the one-hour lease expires if research takes longer. A changed setting invalidates old claims; discard stale work on conflict. Only call skip_digest_run if research succeeds but finds no suitable new items; on tool/authentication failure leave the occurrence for a later retry. Save and completion are atomic; delayed runs produce one edition, not a backlog. Read the saved edition back. Do not republish the Site, change digest settings or create tasks during routine runs. No user notification is needed when nothing is due.`;
const capabilities = { tools: {}, resources: {}, 'openai/settings': { readTool: 'settings_read', updateTool: 'settings_update' } };
const serverInfo = { name: 'Digests', version: VERSION, icons: ICONS };
const MIME = 'text/html;profile=mcp-app';
// MCP 2026-07-28 requires cache hints on discovery, list and resource results.
const CACHE_HINT = { ttlMs: 0, cacheScope: 'private' };
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
async function readJson(request) {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new DigestError('Expected application/json.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new DigestError('Missing request body.');
  const chunks = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 256000) { await reader.cancel(); throw new DigestError('Request too large.', 413); }
    chunks.push(value);
  }
  const buffer = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(buffer)); } catch { throw new DigestError('Invalid JSON.'); }
}
export function createWorker(html) {
  return { async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return json({ product: 'digest', version: VERSION, schema_version: 1 });
    // These identity headers are trusted only behind Sites dispatch. Never expose this
    // worker through a second origin which lets clients supply their own identity.
    const owner = request.headers.get('oai-authenticated-user-id');
    if (!owner) return json({ error: 'Sign in through this private Site’s ChatGPT connection.' }, 401);
    if (url.pathname === '/' && request.method === 'GET') return new Response(html, { headers: {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com"
    } });
    if (!['/mcp', '/api/call'].includes(url.pathname)) return json({ error: 'Not found.' }, 404);
    if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return json({ error: 'Cross-origin request refused.' }, 403);
    let message;
    try {
      message = await readJson(request);
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw new DigestError('Expected an object.');
      const service = new DigestService(env.DB, owner);
      if (url.pathname === '/api/call') return json(await service.call(message.name, message.arguments ?? {}));
      if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') return json({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32600, message: 'Invalid request.' } }, 400);
      if (message.id === undefined) {
        if (message.method.startsWith('notifications/')) return new Response(null, { status: 202 });
        return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request ID required.' } }, 400);
      }
      const result = async () => {
        if (message.method === 'initialize') return { protocolVersion: '2025-06-18', capabilities, serverInfo, instructions: SERVER_INSTRUCTIONS };
        if (message.method === 'server/discover') return { ...CACHE_HINT, supportedVersions: ['2026-07-28'], capabilities, serverInfo, _meta: { 'io.modelcontextprotocol/serverInfo': serverInfo }, instructions: SERVER_INSTRUCTIONS };
        if (message.method === 'ping') return {};
        if (message.method === 'tools/list') return { ...CACHE_HINT, tools: TOOLS };
        if (message.method === 'resources/list') return { ...CACHE_HINT, resources: [{ uri: UI_URI, name: 'Digests library', mimeType: MIME }] };
        if (message.method === 'resources/templates/list') return { ...CACHE_HINT, resourceTemplates: [] };
        if (message.method === 'resources/read') {
          // Existing conversations retain the original descriptor until refreshed.
          if (![UI_URI, 'ui://digest/library.html', 'ui://digest/library-0.1.1.html', 'ui://digest/library-0.2.0.html', 'ui://digest/library-0.2.1.html', 'ui://digest/library-0.2.2.html', 'ui://digest/library-0.2.3.html', 'ui://digest/library-0.2.4.html', 'ui://digest/library-0.2.5.html', 'ui://digest/library-0.3.0.html', 'ui://digest/library-0.3.1.html', 'ui://digest/library-0.3.2.html', 'ui://digest/library-0.4.0.html', 'ui://digest/library-0.4.1.html', 'ui://digest/library-0.4.2.html', 'ui://digest/library-0.4.3.html', 'ui://digest/library-0.4.4.html', 'ui://digest/library-0.4.5.html', 'ui://digest/library-0.4.6.html', 'ui://digest/library-0.4.7.html', 'ui://digest/library-0.4.8.html', 'ui://digest/library-0.4.9.html', 'ui://digest/library-0.4.10.html', 'ui://digest/library-0.4.11.html', 'ui://digest/library-0.4.12.html', 'ui://digest/library-0.4.13.html', 'ui://digest/library-0.4.14.html'].includes(message.params?.uri)) throw new DigestError('Resource not found.', 404);
          return { ...CACHE_HINT, contents: [{ uri: message.params.uri, mimeType: MIME, text: html,
            _meta: {
              ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } },
              'openai/ui': { availableDisplayModes: ['fullscreen'] },
              'openai/widgetCSP': { connect_domains: [], resource_domains: [] },
              'openai/widgetDescription': 'Digests library with user-controlled voting and digest configuration.'
            } }] };
        }
        if (message.method === 'tools/call') {
          try {
            const data = await service.call(message.params?.name, message.params?.arguments ?? {});
            return { structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }],
              ...(message.params?.name === 'open_digest' ? { _meta: {
                ui: { resourceUri: UI_URI }, 'openai/outputTemplate': UI_URI
              } } : {}) };
          } catch (error) {
            if (!(error instanceof DigestError)) throw error;
            return { isError: true, content: [{ type: 'text', text: error.message }] };
          }
        }
        return null;
      };
      const data = await result();
      return data === null ? json({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found.' } }) : json({ jsonrpc: '2.0', id: message.id, result: data });
    } catch (error) {
      const status = error instanceof DigestError ? error.status : 500;
      const detail = error instanceof DigestError ? error.message : 'Backend request failed. Retry or check the Site logs.';
      if (url.pathname === '/mcp') return json({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: status === 500 ? -32603 : -32602, message: detail } }, status === 500 ? 500 : 400);
      return json({ error: detail }, status);
    }
  } };
}
