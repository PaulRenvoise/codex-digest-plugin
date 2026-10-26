CREATE TABLE digests (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  domains TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX digest_owner ON digests(owner_id, created_at);
--> statement-breakpoint
CREATE TABLE editions (
  id TEXT PRIMARY KEY NOT NULL,
  digest_id TEXT NOT NULL REFERENCES digests(id),
  request_key TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(digest_id, request_key)
);
--> statement-breakpoint
CREATE TABLE items (
  id TEXT PRIMARY KEY NOT NULL,
  digest_id TEXT NOT NULL REFERENCES digests(id),
  canonical_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(digest_id, canonical_url)
);
--> statement-breakpoint
CREATE TABLE entries (
  edition_id TEXT NOT NULL REFERENCES editions(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  summary TEXT NOT NULL,
  kind TEXT NOT NULL,
  published_at TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  update_note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(edition_id, item_id)
);
--> statement-breakpoint
CREATE TABLE feedback (
  item_id TEXT PRIMARY KEY NOT NULL REFERENCES items(id),
  vote INTEGER NOT NULL DEFAULT 0 CHECK(vote IN (-1,0,1)),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE preferences (
  owner_id TEXT PRIMARY KEY NOT NULL,
  default_digest_id TEXT REFERENCES digests(id)
);
