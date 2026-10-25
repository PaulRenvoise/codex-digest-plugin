# Digests

Personal digests for ChatGPT and Codex. Define what to find, read dated editions, and vote on links to guide future selections.

Each user owns a private ChatGPT Site and database. This repository contains the plugin and backend template—no shared endpoint, personal Site identity, or user data.

## Setup

1. Install from this repository’s marketplace through your supported plugin UI.
2. With Sites available, ask **“Use setup-digest to create my Digests backend on Sites.”** You can also connect an existing Digests Site.
3. Complete installation and sign-in for the runtime plugin created by Sites.
4. Open **Digests → New digest**. Use **Find more** to research and save another edition; earlier editions stay intact.

Hosting is created only when requested. Each user creates their own backend or connects one they can access.

## Settings and use

| Setting | Behavior |
| --- | --- |
| Name | Identifies an independent digest. |
| Prompt | Topics, interests, depth, freshness, and exclusions. Card presentation is built in. Explicit preferences take priority over inferred taste. |
| Preferred sources | Domains or URLs, including authors, communities and pages. Paths are preserved; search extends beyond this list. |
| Items per edition | 1–30; default 12. Fewer when there aren’t enough useful links. |
| Frequency | Daily, weekly, or monthly, with day, hour, and fixed UTC offset. |

Edit settings in the panel; choose the default digest in native plugin settings. Each edition shows linked titles, summaries, and source details. Upvote or downvote a link; click the selected vote again to clear it. No bookmarks or comments.

**Shared research rules:** verify reachable original links, use targeted creators and communities, label verified dates accurately, and default to at most two items per editorial source with sources interleaved. Aggregators and social posts lead to original material unless they contain the substance themselves.

**No repeat links within a digest.** Canonical URL checks ignore common tracking parameters and fragments, reject repeats even with an update note, and protect concurrent saves. History includes titles and summaries to help catch the same story at different URLs; that comparison still relies on research judgment. Different digests may include the same link.

**Scheduling requires a confirmed cloud job.** Saving a changed frequency asks ChatGPT to apply a linked Sites task; the standalone UI provides a request to copy. ChatGPT verifies access, creates or updates the job, and confirms its status. Installation alone creates no task. Runs reread current settings, history, and votes; stale schedules skip work, and jobs can be disabled in the scheduler.

Timing defaults to daily at 09:00: UTC for API/database defaults, the current whole-hour UTC offset in the form. Offsets range from UTC−12 to UTC+14 without daylight-saving adjustments. Monthly dates clamp to the last day of shorter months. Legacy manual settings migrate to daily at 09:00 UTC without creating jobs.

## How it works

| Component | Role |
| --- | --- |
| GitHub plugin | Setup, upgrade, research, and management skills. |
| Sites backend | Data tools, library UI, and persistent digests, editions, and votes. |
| Sites runtime plugin | Hosted MCP connection, with sidebar and conversation-panel entrypoints. Its app connection can also appear in Apps settings. |

The GitHub companion and hosted runtime are separate registrations; a URL setting cannot rewire a connection. Hosted research instructions support ordinary use without local scripts. Research uses the invoking conversation’s tools—no autonomous crawler or separate model API subscription.

The dependency-free Worker ESM backend uses D1 and **requires Sites dispatch** for authenticated identity. Every operation checks ownership; edition writes are atomic, and revisions prevent conflicting edits or votes. Never expose the raw Worker where identity headers could be spoofed.

The embedded MCP Apps bridge and authenticated standalone UI share one database. Use the plugin normally; the Site is a fallback. No local proxy or continuously running computer is required after deployment.

**Compatibility:** UI and settings support depend on the host/account. Desktop panel loading and the New digest form are verified; tests cover votes and host messages. Mobile rendering and live panel vote persistence remain unverified. Browser previews and backend tests do not establish native mobile support; setup reports these checks separately.

## Development and deployment

Requires **Node.js 22.13+**; 24+ recommended for SQLite tests. No dependency installation needed.

```sh
npm test
npm run check
npm run build
npm run dev
```

Preview: `http://127.0.0.1:4318`, with a development identity and in-memory database. Set `DIGEST_DEV_DB` to an ignored `.sqlite` file for persistence. Keep preview local; hosted code has no development identity fallback.

Tests use real SQLite through a D1 adapter, covering ownership, votes, conflicting edits, duplicates, retries, rollback, pagination, MCP discovery, authentication, and template preservation.

```sh
# Create a backend checkout
node plugins/digests/scripts/materialize-backend.mjs /absolute/new/digest-backend

# Upgrade an existing managed checkout
node plugins/digests/scripts/materialize-backend.mjs /absolute/existing/digest-backend --upgrade
```

These commands copy files, not deploy. Setup and upgrade skills handle the Sites workflow: register when needed, preserve the project ID, sync source, build with `node scripts/build.mjs`, package, and publish privately. The generated manifest declares `DB` and `mcp`; personal identity stays in the deployment repository. Upgrades preserve identity and reject unmerged customizations or rewritten migrations. See the [deployment contract](plugins/digests/references/deployment.md).

## Layout

```text
.agents/plugins/marketplace.json   Repository marketplace
plugins/digests/                   Installable plugin
  .codex-plugin/plugin.json        Plugin manifest
  skills/                         Setup, research, management, upgrade
  scripts/                        Materializer, checks, local preview
  references/                     Deployment contract
  templates/backend/              Server, UI, migrations, build
  tests/                          Integration tests
package.json                      Development commands
```
