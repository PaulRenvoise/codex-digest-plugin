# Digests

A personal digest plugin for ChatGPT and Codex. Create digests with a **name**, **prompt**, **non-exhaustive preferred domains**, **items per edition**, and **frequency**. Read editions and upvote or downvote links to guide future selections.

Each user deploys a private backend to their own ChatGPT Site. Digests, articles and votes live in that Site's database and can be used from supported desktop and mobile clients. This repository contains no shared service endpoint, personal Site identity or user data.

## Setup

1. Install this repository as a Codex plugin using its marketplace, or add the repository through your supported plugin installation UI. The marketplace is `.agents/plugins/marketplace.json`; the companion plugin manifest is `plugins/digests/.codex-plugin/plugin.json`.
2. Ask **“Use setup-digest to create my Digest backend on Sites.”** Sites must be available in the setup session. Alternatively, identify an existing Digest Site to connect.
3. Setup deploys the bundled backend template to a private Site and connects the runtime plugin that Sites creates. Complete the native installation/sign-in flow if prompted.
4. Open the deployed Digests plugin, choose **New digest**, and supply a prompt and preferred domains. **Find more** asks ChatGPT to research and save a new edition.

The GitHub companion supplies setup, upgrade and research skills. The deployed Site supplies the actual data tools and interface. Sites creates an app connection alongside its runtime plugin; that connection can appear in the host’s Apps settings. The GitHub companion and hosted runtime are separate plugin registrations: changing a URL in product settings does not reconfigure ChatGPT's server connection. The remote server includes research instructions so ordinary use does not depend on local scripts.

## What is included

- Multiple independent digests, dated editions and persistent votes.
- Minimal responsive library: configuration, edition selector, article titles/summaries, upvote and downvote. Click a selected vote again to clear it.
- MCP App resource with global/sidebar and thread/panel entrypoints.
- Native plugin setting for the default digest. Edit each digest's prompt and domains in the panel.
- Preferred-domain normalization, strict canonical URL deduplication across all editions of each digest, including concurrent saves.
- Feedback and history pagination for research. Explicit prompts take priority over inferred preferences.
- Authenticated ownership checks, atomic edition writes and revision checks for concurrent edits/votes.
- Versioned setup template and an upgrade helper that preserves deployment identity and rejects unmerged customizations or rewritten migration history.

No bookmarks, comments, autonomous crawler or model API subscription. Research uses the tools available in the invoking ChatGPT/Codex conversation. The backend stores verified selections and feedback; it does not itself browse the web. **Find more** saves another edition rather than altering an earlier one.

## Hosting and compatibility

The backend is a dependency-free Worker ESM application with D1 storage. It is designed **only for Sites dispatch**, which authenticates requests and supplies the Site-scoped user ID. Never expose the raw Worker on an alternate origin that accepts spoofed identity headers. Every data operation separately checks ownership.

The browser UI and embedded MCP UI use the same database. A regular browser visit uses authenticated same-origin requests; the embedded UI uses the MCP Apps bridge. No local proxy or Mac running in the background is required after deployment.

Native UI metadata is implemented, but availability of custom plugin UI, settings and mobile presentation depends on the host/account. Verify the generated Sites plugin on your intended clients. A passing backend test or responsive browser preview does not establish native mobile compatibility. The setup skill reports these separately.

The desktop integration was verified in the desktop MCP App panel: the hosted library loads and the New digest form opens. Automated tests cover votes and the embedded host message flow; mobile rendering and live panel vote persistence remain unverified. Open Digests through its plugin entry point for normal use; the standalone Site is an optional fallback.

## Per-digest settings

Choose 1–30 items per edition (default 12). Generation uses this target and returns fewer when there are not enough useful links.

The prompt describes what to find; linked cards, summaries, source metadata and voting controls are built in. Previously shown canonical URLs are rejected even with an update note. Tracking parameters and URL fragments are ignored for duplicate checks. Research history includes titles and summaries to help avoid the same story at different URLs; semantic duplicates still depend on research judgment. The same link may appear in different digests.

The form offers daily, weekly, and monthly frequency as one sentence, with the relevant day, hour, and UTC offset. New digests default to daily. API/database defaults use 09:00 UTC; the form starts at 09:00 in the current whole-hour UTC offset. Existing retired manual settings migrate to daily at 09:00 UTC without creating any scheduler jobs. UTC offsets are fixed whole hours from UTC−12 to UTC+14; they do not follow daylight saving. Monthly dates use the last day in shorter months.

Saving a changed frequency sends a request to ChatGPT to apply a linked Sites cloud task. The standalone fallback provides a request to copy. The saved cadence is not an active-job indicator: ChatGPT must verify access, create or update the scheduler task, and confirm its actual status. No task is created just by installing the plugin. Scheduled runs reread the current item count and editorial settings; an old schedule must skip work after its cadence changes or is disabled through the scheduler.

## Local development

Node.js **22.13+** is required (24+ recommended for the built-in SQLite test adapter). No npm install is needed.

```sh
npm test
npm run check
npm run build
npm run dev
```

The loopback preview runs at `http://127.0.0.1:4318`, uses a development identity and starts with an in-memory database. Set `DIGEST_DEV_DB` to an ignored local `.sqlite` file to retain development data. Never expose this server publicly. The hosted backend has no development identity fallback.

Tests exercise real SQLite constraints through a D1-compatible adapter, including tenant separation, vote persistence/clearing, stale updates, duplicate links, retry behavior, rollback, pagination, MCP discovery, authentication and deployment template preservation.

## Deployment template

```sh
node plugins/digests/scripts/materialize-backend.mjs /absolute/new/digest-backend
```

This copies the template without registering or publishing a Site. Use the Sites workflow to register the generated project, persist its returned project ID, synchronize source, run `node scripts/build.mjs`, package and publish privately. The generated hosting manifest declares `DB` and `mcp`; the published source's project ID stays in that deployment's repository.

For an existing managed deployment:

```sh
node plugins/digests/scripts/materialize-backend.mjs /absolute/existing/digest-backend --upgrade
```

Use the `upgrade-digest` skill for the complete source-checkout and publication workflow. The helper alone does not deploy. See [deployment details](plugins/digests/references/deployment.md).

## Layout

```text
.agents/plugins/marketplace.json  Repository marketplace
plugins/digests/                  Self-contained installable plugin
  .codex-plugin/plugin.json      Plugin manifest
  skills/                        Setup, generation, management and upgrade workflows
  scripts/                       Template materializer, checks and local preview
  references/                    Hosting and connection contract
  templates/backend/             Portable server, UI, migrations and build script
  tests/                         Behavioral integration tests
package.json                     Repository development commands
```

No GitHub-hosted install hook silently creates hosting or sends users to the author's Site. Users explicitly create their own backend or connect an existing one they can access.
