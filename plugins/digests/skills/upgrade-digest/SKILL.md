---
name: upgrade-digest
description: Upgrade an existing personal Digests Site from this plugin's versioned backend template while preserving its Site identity, database, access settings and user data.
---

# Upgrade a Digests backend

Resolve the existing Site and read its identity, current access and backend version. Read [the deployment contract](../../references/deployment.md) and the current Sites skill. Open the Site's actual source checkout using Sites' source helper; do not create another Site.

Run `node scripts/materialize-backend.mjs <absolute-existing-checkout> --upgrade` from this plugin's root. The helper checks its previous file inventory before changing files, rejects unmanaged source changes, preserves `.openai/hosting.json`, and refuses rewritten migration history. If it reports local modifications, inspect and merge them deliberately; do not delete them to make the upgrade pass. If the checkout lacks its template inventory, inspect and plan a manual migration instead of assuming it is disposable.

Keep applied migrations immutable and add schema changes as new migrations. Run the package tests and backend build before synchronizing exact source and publishing with the existing Site's audience. A failed deployment can have applied migrations: inspect the reported state before retrying. Do not create a fresh database, rename its DB binding, or roll back schema by overwriting SQL.

Verify the same backend identity and version through its connected plugin, then read an existing digest and edition. Do not manufacture a user vote to test persistence. Report source/build verification separately from hosted and mobile UI verification. Never commit this user's Site ID, URL, database contents or credentials to the public template repository.
