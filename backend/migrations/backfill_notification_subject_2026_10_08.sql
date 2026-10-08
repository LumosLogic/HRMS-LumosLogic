-- One-off backfill of notifications.subject_user_id for notifications created BEFORE tagging existed.
-- Only fills a row when the employee can be identified UNAMBIGUOUSLY; anything else stays NULL (shown in every branch).
-- Safe to re-run (only touches rows where subject_user_id IS NULL).
BEGIN;

-- 1) Messages that start with / contain a unique employee name: "<Name> uploaded ...", "<Name> requested ...",
--    "<Name>'s resignation ...", "<Name> submitted ..." etc.
WITH uniq AS (
  SELECT organization_id, lower(trim(name)) AS nm, MIN(id) AS uid
  FROM users
  WHERE name IS NOT NULL AND trim(name) <> ''
  GROUP BY organization_id, lower(trim(name))
  HAVING COUNT(*) = 1
),
cand AS (
  SELECT n.id AS nid, u.uid, length(u.nm) AS len,
         ROW_NUMBER() OVER (PARTITION BY n.id ORDER BY length(u.nm) DESC) AS rn,
         COUNT(*)     OVER (PARTITION BY n.id, length(u.nm)) AS same_len
  FROM notifications n
  JOIN uniq u ON u.organization_id = n.organization_id
   AND (lower(n.message) LIKE u.nm || ' %' OR lower(n.message) LIKE u.nm || '''s %'
        OR lower(n.message) LIKE '% ' || u.nm || ' %' OR lower(n.message) LIKE '%' || u.nm || '''s %')
  WHERE n.subject_user_id IS NULL
    AND n.type IN ('document','regularization','exit','expense','leave')
)
UPDATE notifications n SET subject_user_id = c.uid
FROM cand c WHERE c.nid = n.id AND c.rn = 1 AND c.same_len = 1;

-- 2) Onboarding task alerts have no name: attribute only when exactly ONE employee has an open task with that title.
WITH t AS (
  SELECT n.id AS nid,
         (SELECT array_agg(DISTINCT o.user_id) FROM onboarding_checklists o
           WHERE o.organization_id = n.organization_id AND o.completed = FALSE
             AND n.message = 'Onboarding: "' || o.title || '" requires ' || o.assigned_to || ' action.') AS users_
  FROM notifications n
  WHERE n.subject_user_id IS NULL AND n.type = 'onboarding' AND n.title = 'Onboarding Task Ready'
)
UPDATE notifications n SET subject_user_id = t.users_[1]
FROM t WHERE t.nid = n.id AND array_length(t.users_, 1) = 1;

SELECT type, COUNT(*) FILTER (WHERE subject_user_id IS NOT NULL) AS tagged,
       COUNT(*) FILTER (WHERE subject_user_id IS NULL) AS untagged
FROM notifications GROUP BY type ORDER BY type;
COMMIT;

-- 3) Second pass (run after the first): probation notices (type 'general') and names embedded in file names
--    ("Payslip_First_Last_08_2026" -> "first last"). Same unique-name rule as above.
BEGIN;
WITH uniq AS (
  SELECT organization_id, lower(trim(name)) AS nm, MIN(id) AS uid
  FROM users WHERE name IS NOT NULL AND trim(name) <> ''
  GROUP BY organization_id, lower(trim(name)) HAVING COUNT(*) = 1
),
cand AS (
  SELECT n.id AS nid, u.uid, length(u.nm) AS len,
         ROW_NUMBER() OVER (PARTITION BY n.id ORDER BY length(u.nm) DESC) AS rn,
         COUNT(*)     OVER (PARTITION BY n.id, length(u.nm)) AS same_len
  FROM notifications n
  JOIN uniq u ON u.organization_id = n.organization_id
   AND replace(lower(n.message), '_', ' ') LIKE '%' || u.nm || '%'
  WHERE n.subject_user_id IS NULL
    AND ( (n.type = 'general' AND n.title LIKE 'Probation Completed%')
       OR (n.type = 'document' AND n.title = 'Document Deleted') )
)
UPDATE notifications n SET subject_user_id = c.uid
FROM cand c WHERE c.nid = n.id AND c.rn = 1 AND c.same_len = 1;
COMMIT;

-- 4) Notifications addressed to a person about THEIR OWN request ("Your leave request ... approved") belong to that
--    person. Tag subject = recipient so they follow the recipient's branch (a Root Admin has no branch, so these
--    appear under "All branches" only, never inside another branch's view).
BEGIN;
UPDATE notifications SET subject_user_id = user_id
WHERE subject_user_id IS NULL
  AND type IN ('leave','regularization','expense','exit','document')
  AND message LIKE 'Your %';
COMMIT;
