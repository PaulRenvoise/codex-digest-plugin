# Deployment and upgrades

Use the installed Sites skill and supported Sites tools for source synchronization, credentials, publication, and connection. This repository is Site source, not an installable companion plugin. No separate model API key is required by the current backend; research runs in ChatGPT, either on demand or through the shared cloud task.

## New instance

1. Read this repository's source and run its tests and checks. Prepare an isolated deployment checkout from the public source:

   ```sh
   node scripts/prepare-site.mjs /absolute/new/digests-site
   ```

2. Read the generated `.openai/hosting.json`. Create a private Site named **Digests** only when it has no `project_id`; persist the exact returned ID in that deployment checkout. Preserve `d1: "DB"` and `capabilities: ["mcp"]`. Do not register twice after an uncertain response.
3. Follow the current Sites source helper workflow. Build with `node scripts/build.mjs`, push the exact source, package its build output, and publish privately. The dependency-free Worker build emits `dist/server/index.js`, `dist/.openai/hosting.json`, and migrations under `dist/.openai/drizzle/`.
4. Read `get_site` with `include_mcp_connection: true`. Reuse the plugin Sites created when publishing the MCP capability. If installation is unconfirmed and tools are missing, offer that exact plugin ID through the supported installation UI. The user may need to complete Install/Connect. Do not create a second MCP connection or add a local proxy.
5. Verify `backend_info` reports product `digest`, the expected version, and schema version 1. Call `open_digest` and verify the embedded panel renders. Check existing data where available; only the user may submit votes. Distinguish a deployed endpoint, installed plugin, available model tools, and rendered UI; success at one does not establish the others. If tools remain missing after confirmed installation, report the unresolved connection issue rather than repeating installation advice.

The user interacts through ChatGPT/Codex's supported panels and conversations. Opening the standalone Site is optional. Test mobile and desktop separately; a desktop preview is not mobile verification. Do not silently create sample digests or import other chats.

## Existing instance

Resolve the user's existing Site through Sites inventory, preserve its audience, and open its source with the Sites source helper **before modifying that checkout**. From the updated public repository run:

```sh
node scripts/prepare-site.mjs /absolute/existing/site-checkout --upgrade
```

The helper supports inventories produced by the former GitHub plugin. It preserves `.openai/hosting.json` (including the Site ID and bindings), checks previously managed files before writing, and refuses rewritten migrations or unmerged customizations. The existing `.digest-template.json` inventory name is retained for upgrade compatibility. If it is missing, inspect and merge manually; never assume an existing checkout is disposable.

Run tests/checks in the public source and build the deployment. Synchronize, package, and publish the same Site through the current Sites workflow, preserving access. Do not create a replacement database. A failed deployment may have applied migrations: inspect the failure before retrying. Verify backend version and an existing digest/edition through the connected plugin when tools are available. Never fabricate votes for testing.

## Hosting and data contract

- Stateless JSON-RPC `POST /mcp`; Sites authenticates callers and supplies a Site-scoped `oai-authenticated-user-id`. Every operation checks record ownership. A service bypass token is not a user identity. Do not expose the raw Worker on an origin where callers can spoof identity headers.
- The public `.openai/hosting.json` has no personal ID. The preparation helper copies only source directories and named public files, excluding local deployments, credentials, databases, and build output. Private identity and runtime data belong only to each deployment.
- Keep SQL migrations under `drizzle/` immutable and append new migrations. Sites applies them at publication; request handlers never create schema.
- Keep MCP discovery/list/resource cache hints (`ttlMs: 0`, `cacheScope: "private"`). Preserve old UI resource URIs for cached conversations.
- `open_digest` exposes global and thread entrypoints and returns the MCP Apps HTML resource. The embedded panel uses the host bridge; the optional browser fallback uses authenticated same-origin `/api/call`. Both use the same database. Refresh through data tools, not recursive `open_digest` calls.
- Research and tool instructions are returned by the MCP server and `get_research_context`; they do not depend on a locally installed skill. [Research](research.md) and [management](management.md) document the workflows.
- Enable one shared hourly Sites cloud task after verifying unattended read/write access. The backend owns per-digest next-run times and claims. Settings saves never send conversation messages or synchronize cloud jobs. Routine editions do not require republishing. See [scheduling](management.md).

## References

- [Sites MCP hosting](https://learn.chatgpt.com/docs/extend/mcp)
- [MCP Apps UI](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Plugin extensions](https://developers.openai.com/plugins/build/extensions)
