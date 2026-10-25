# Digest deployment contract

- Runtime: dependency-free Worker ESM, D1 binding `DB`, stateless JSON-RPC `/mcp`.
- Template: `templates/backend`. Materialize with `scripts/materialize-backend.mjs` from the package root. Generated source is owned by that deployment, not edited inside the installed plugin cache.
- Build command in the generated project: `node scripts/build.mjs`. It produces `dist/server/index.js`, `dist/.openai/hosting.json` and `dist/.openai/drizzle/`. Use the current Sites workflow to push, package and publish that exact source. No dependency install is needed.
- Register with Sites only when `.openai/hosting.json` lacks a project ID. The public template always lacks one. Store the returned ID in the generated project's hosting manifest, never the shared template.
- SQL migrations live in `drizzle/` with an append-only journal. Sites applies hosted migrations at publication. Request handlers never create tables. Local preview applies schema only to its local database.
- Authentication is supplied by Sites dispatch. Every private operation requires `oai-authenticated-user-id`, and database ownership is checked on every operation. Never deploy this Worker on an unprotected origin where clients can spoof that header. A service bypass token is not a user identity.
- Sites creates the runtime plugin when the owner publishes with `capabilities: ["mcp"]`. Reuse its returned plugin ID. Do not add a second connection via `codex mcp add`.
- `backend_info` reports product, version and schema compatibility. `open_digest` advertises both global and thread entrypoints. `resources/read` returns the UI. `save_feedback` is app-only in discovery metadata; host enforcement must be verified. All operations still enforce authenticated ownership server-side.
- The normal browser UI uses authenticated same-origin `/api/call`; embedded UI uses the MCP Apps bridge. Both access the same database. UI support varies by host and must be tested on the intended desktop/mobile surfaces.
- Native plugin settings choose the default digest. No backend URL field is exposed: it would not alter ChatGPT's connection registration.
- The backend does not call a model or web search API. Research happens in the invoking ChatGPT/Codex session; remote server instructions make the core workflow available without the GitHub companion skill. Scheduled/offline generation is not implemented.

## Distribution boundary

Publish template source, schemas, skills, tests and instructions. Do not publish generated `.digest-template.json` inventories, deployment project IDs, private endpoints, SQLite files, credentials, source-push tokens or article/vote exports in the shared repository. Each deployment creates its own private Site and database. An existing backend must implement this protocol; a random Site URL is not compatible.

## Upgrade boundary

The materializer stores hashes of managed template files in `.digest-template.json` inside the generated project. Upgrade refuses custom modifications and removal of managed files so the operator can merge intentionally. It preserves hosting configuration, adds new managed files and verifies that migration history is unchanged. It does not deploy, change account connections or migrate data between Sites.

## References

- [Sites MCP hosting and connection workflow](https://learn.chatgpt.com/docs/extend/mcp)
- [Plugin extensions](https://developers.openai.com/plugins/build/extensions)
- [MCP App UI](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Plugin packaging](https://developers.openai.com/plugins/build/plugins)
