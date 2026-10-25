ALTER TABLE digests ADD COLUMN schedule_recurring TEXT NOT NULL DEFAULT '{"frequency":"daily","hour":9,"utc_offset_minutes":0}';
--> statement-breakpoint
UPDATE digests SET schedule_recurring = CASE
  WHEN json_extract(schedule, '$.frequency') = 'manual' THEN '{"frequency":"daily","hour":9,"utc_offset_minutes":0}'
  ELSE schedule END,
  revision = revision + CASE WHEN json_extract(schedule, '$.frequency') = 'manual' THEN 1 ELSE 0 END;
--> statement-breakpoint
ALTER TABLE digests DROP COLUMN schedule;
--> statement-breakpoint
ALTER TABLE digests RENAME COLUMN schedule_recurring TO schedule;
