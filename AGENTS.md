# Development

- Keep the distributed template free of deployment IDs, private endpoints, credentials and user records. Personal deployments belong outside the tracked source.
- Preserve the minimal UI: no bookmarks, comments, decorative headers or flavor text.
- Run `npm test`, `npm run check` and `npm run build` after backend or template changes. Verify relevant UI interactions through a browser.
- Never claim embedded-panel or mobile compatibility from a plain browser test.
- Follow the current Sites workflow for private publication. Preserve project identity, database binding and access policy. Do not mutate applied migrations.

# Git

- Default branch: `main`. Use `type/short-description` for working branches, with lowercase hyphen-separated descriptions; no extra prefix.
- Use Conventional Commits: `type(scope): description`, with a concise imperative description.
- Preserve scope casing. For edits centered on an existing file, use its area and filename without extension or intermediate folders; for new files, use their domain. For root documents, use the document name.
- Remote GitHub Actions and reusable workflows must use a verified full 40-character upstream SHA with the matching release version in an inline comment. Local `uses: ./...` references are exempt.
