ALTER TABLE digests ADD COLUMN next_run_at TEXT;
--> statement-breakpoint
CREATE TABLE digest_runs (
  id TEXT PRIMARY KEY,
  digest_id TEXT NOT NULL REFERENCES digests(id),
  scheduled_for TEXT NOT NULL,
  digest_revision INTEGER NOT NULL,
  claim_token TEXT NOT NULL,
  lease_until TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'skipped')),
  edition_id TEXT REFERENCES editions(id),
  finished_at TEXT,
  UNIQUE(digest_id, scheduled_for)
);
--> statement-breakpoint
CREATE INDEX digests_due ON digests(owner_id, next_run_at);
--> statement-breakpoint
CREATE TRIGGER validate_digest_run_completion BEFORE UPDATE OF status ON digest_runs
WHEN NEW.status IN ('completed', 'skipped')
BEGIN
  SELECT CASE WHEN OLD.status != 'running' OR OLD.claim_token != NEW.claim_token
    OR OLD.lease_until <= NEW.finished_at
    OR NOT EXISTS (SELECT 1 FROM digests WHERE id = OLD.digest_id
      AND revision = OLD.digest_revision AND next_run_at = OLD.scheduled_for)
    THEN RAISE(ABORT, 'Scheduled run expired or settings changed') END;
END;
