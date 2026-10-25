ALTER TABLE digests ADD COLUMN items_per_edition INTEGER NOT NULL DEFAULT 12 CHECK(items_per_edition BETWEEN 1 AND 30);
--> statement-breakpoint
ALTER TABLE digests ADD COLUMN schedule TEXT NOT NULL DEFAULT '{"frequency":"manual"}';
