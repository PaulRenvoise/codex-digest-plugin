# Digests

Personal digests in ChatGPT panels and conversations, backed by a private ChatGPT Site. Define what to find, read editions, and vote on links to guide future selections. Mobile and desktop use the same stored data.

This repository contains the Site source. Publishing its MCP server through Sites creates the **Digests** plugin you connect in ChatGPT or Codex. There is no separate GitHub plugin to install, and normal use does not require opening the Site in a browser.

## Setup

With Sites enabled, give your assistant [this repository](https://github.com/PaulRenvoise/codex-digests-site) and ask:

> Deploy this repository as my own private Digests Site. Follow docs/deployment.md, connect the plugin Sites creates, and verify its tools and embedded UI.

Complete Install/Connect if prompted, then open **Digests → New digest**. Each user gets their own Site and database; the public source contains no personal endpoint, Site ID, or data. There is no one-click GitHub deployment button.

Already have a Digests Site? Ask the assistant to upgrade it using this repository. Keep the existing Site, plugin connection, database, and access settings.

## Use

- **Prompt:** topics, interests, freshness, depth, and exclusions.
- **Preferred sources:** domains or URLs, including specific creators and communities; research also explores other sources.
- **Items per edition:** 1–30, with fewer when quality warrants it.
- **Frequency:** daily, weekly, or monthly, at an hour and fixed UTC offset.
- **Find more:** request a new edition. Earlier editions remain available.
- **Votes:** upvote or downvote; click again to clear.

Research instructions come from the backend: verify original links and dates, diversify sources, and avoid previously included items. Canonical URL uniqueness is enforced per digest. See [research rules](docs/research.md).

**Scheduling is not automatic yet.** Creating a digest or saving settings makes a direct backend call and sends no conversation message. Frequency is saved timing only; saves do not create or update cloud jobs. Direct job management from Site code has no verified supported integration. A saved frequency is not proof of an active job. See [management and scheduling](docs/management.md).

**Verification limits:** the embedded desktop panel and forms have been exercised; mobile safe areas were checked in simulated portrait/landscape previews. Actual mobile behavior and unattended generation remain unverified. A reported connection issue can leave the panel working while the assistant receives no backend tools; removing the companion package does not resolve that issue.

## Development

Node.js 22.13+; 24+ recommended. No dependencies to install.

```sh
npm test
npm run check
npm run build
npm run dev
```

Preview at `http://127.0.0.1:4318` uses a local development identity and in-memory database. Set `DIGEST_DEV_DB` to an ignored SQLite path for persistence. Keep preview local.

```text
src/       MCP tools, research instructions, data operations
ui/        Embedded panel (also serves the browser fallback)
drizzle/   Append-only database migrations
scripts/   Build, preview, validation, deployment preparation
tests/     Backend, panel, migration, and deployment checks
docs/      Setup, upgrades, research, and scheduling
.openai/   Hosting template without a personal Site ID
```

Deployment uses the [Sites workflow](docs/deployment.md). Keep the reusable GitHub source separate from each Site's deployment checkout and private data.
