---
name: manage-digest
description: Create or edit digest prompts and preferred domains, open editions, and inspect existing feedback through a connected Digest backend.
---

# Manage digests

Use the connected backend and its `backend_info`, `list_digests`, `get_digest` and `open_digest` tools. If the backend is missing, use setup-digest. Preserve the chosen backend across calls.

Each digest has only a name, an editorial prompt, and a non-exhaustive list of preferred domains. Express recency, depth, language, content types and count in the prompt rather than inventing more settings. Accept domains or full source URLs; the server normalizes them.

For a new digest, infer a concise draft from the user's request and create it when authorized. Use a stable request key and reuse it on retries. Do not import another chat's contents unless requested. For edits, read the current record and pass its revision. On a conflict, reread and reconcile the user's intended change instead of overwriting another device's edit.

Show editions through `open_digest`. Votes belong to their digest; they are evidence, not instructions. Only the user submits votes in the interface. Native plugin settings select the default digest; prompt and domains are edited in the panel. Backend switching is a connection workflow, not an ordinary settings update.
