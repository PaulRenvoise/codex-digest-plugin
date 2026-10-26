-- Preserve existing topical headlines; derive a content headline from the first
-- two articles when the old title only names the digest. No article data changes.
WITH source AS (
  SELECT e.id, e.title, d.name,
    strftime('%Y-%m-%d', e.created_at,
      printf('%+d minutes', COALESCE(json_extract(d.schedule, '$.utc_offset_minutes'), 0))) AS edition_date,
    (SELECT COUNT(*) FROM entries WHERE edition_id = e.id) AS item_count,
    CASE WHEN instr(e.title, ' — ') > 0 THEN instr(e.title, ' — ')
      ELSE instr(e.title, ' - ') END AS separator,
    (SELECT group_concat(title, ' and ') FROM
      (SELECT title FROM entries WHERE edition_id = e.id ORDER BY position LIMIT 2)) AS article_headline
  FROM editions e JOIN digests d ON d.id = e.digest_id
), headlines AS (
  SELECT *, CASE
    WHEN title = name OR substr(title, 1, length(name) + 3) IN (name || ' — ', name || ' - ')
      THEN COALESCE(article_headline, name)
    WHEN separator > 0 AND (
      substr(title, 1, separator - 1) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      OR substr(title, 1, separator - 1) GLOB '[0-9]* [12][0-9][0-9][0-9]')
      THEN substr(title, separator + 3)
    ELSE title END AS headline
  FROM source
)
UPDATE editions SET title = (
  SELECT edition_date || ' - ' || trim(headline) || ' - ' || item_count || ' items'
  FROM headlines WHERE headlines.id = editions.id
);
