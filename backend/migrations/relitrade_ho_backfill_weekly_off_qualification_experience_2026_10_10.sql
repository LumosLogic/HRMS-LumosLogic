-- ============================================================
-- relitrade_ho_backfill_weekly_off_qualification_experience_2026_10_10.sql
--
-- Purpose:
--   relitrade_ho_branch_employee_import_2026_10_01.sql is ALREADY LIVE in production
--   and is NOT modified or re-run. It skipped three CSV fields. This separate,
--   idempotent backfill adds them for the HO employees it imported:
--     1. WeeklyOffDay            -> users.weekly_off_day            ('Sunday')
--     2. Qualification           -> employee_qualifications          (1 row)
--     3. Experience (prev. job)  -> employee_experiences             (1 row)
--
-- Source: client employee-master export (HO file, 2026-10-10 re-export).
--
-- Which employees are touched (both must hold, otherwise skipped + listed in a NOTICE):
--   • org 1, employee_id is in the staged list below
--   • currently on the HO branch (code MAIN)
--   Employees who existed on HO before the 2026-10-01 import are INCLUDED (no created_at filter);
--   they are protected only by the "fill only if empty / insert only if absent" guards below.
--   Staged employees not on HO (or not in the DB) are skipped and listed as SKIPPED in a NOTICE.
--
-- Idempotent / never overwrites:
--   • weekly_off_day: set only while NULL or ''. A value already saved is kept.
--   • qualification : inserted only if the employee has NO employee_qualifications row.
--   • experience    : inserted only if the employee has NO employee_experiences row.
--   Re-running inserts nothing new (unless someone has deleted the imported rows).
--
-- Column mapping (verified against education.routes.js / experience.routes.js / the profile UI):
--   Qualification text -> specialization (verbatim, shown as the pill next to the title)
--                         degree_level   (fixed UI list: 'SSC / 10th','HSC / 12th','Diploma',
--                                         'Graduation','Post Graduation','PhD','Other' — category
--                                         chosen from the degree text)
--     There is NO dedicated "degree name" column. institution is left NULL (not in the CSV).
--   "<Designation> In (<Company>)" -> designation + company_name (split at the last " In (").
--     start_date / end_date / ctc are NOT in the CSV and are left NULL (nothing invented).
--
-- Not touched: attendance, leaves, payroll, branch work schedules, shifts, other branches,
--              any column other than the three above. Weekly off here is profile data only —
--              attendance/payroll do not read users.weekly_off_day (see report).
--
-- HOW TO EXECUTE (this file never commits on its own):
--   1. DRY RUN — run it exactly like this and read every NOTICE and SELECT result:
--        psql -v ON_ERROR_STOP=1 -f relitrade_ho_backfill_weekly_off_qualification_experience_2026_10_10.sql
--      The file opens a transaction (BEGIN;) and the final COMMIT; is commented out, so when
--      psql reaches the end of the file and disconnects, the open transaction is rolled back
--      automatically and the database is left unchanged. With ON_ERROR_STOP=1 any error stops
--      psql immediately and the same rollback happens.
--   2. REAL RUN — only after the dry-run output has been reviewed and is correct: remove the
--      leading "-- " from the last "COMMIT;" line, then run the same command again and confirm
--      the NOTICE counts match the dry run. (Sequence numbers consumed by the dry run are not
--      reused; gaps in ids are harmless.)
-- Generated : 2026-10-10   Author: Lumos Logic
-- ============================================================

BEGIN;

-- emp_id, weekly_off ('Sunday' or NULL), degree text, degree_level category, previous designation, previous company
CREATE TEMP TABLE _ho_bf (
  emp_id TEXT PRIMARY KEY, weekly_off TEXT,
  qual TEXT, qual_level TEXT,
  prev_desig TEXT, prev_company TEXT
) ON COMMIT DROP;

INSERT INTO _ho_bf VALUES
('401', NULL,     'B.COM',                                         'Graduation',      NULL, NULL),
('403', 'Sunday', NULL,                                            NULL,              NULL, NULL),
('405', 'Sunday', 'B.COM',                                         'Graduation',      'KYC', 'INNOVATE SECURITIES PVT LTD'),
('407', 'Sunday', NULL,                                            NULL,              NULL, NULL),
('408', 'Sunday', 'B.COM',                                         'Graduation',      NULL, NULL),
('419', 'Sunday', NULL,                                            NULL,              NULL, NULL),
('420', 'Sunday', NULL,                                            NULL,              NULL, NULL),
('423', 'Sunday', NULL,                                            NULL,              NULL, NULL),
('425', 'Sunday', 'Bachelor of Law',                               'Graduation',      NULL, NULL),
('431', 'Sunday', '12th Pass',                                     'HSC / 12th',      NULL, NULL),
('432', 'Sunday', NULL,                                            NULL,              NULL, NULL),
('433', 'Sunday', 'Post Graduate Diploma in Computer Applications','Diploma',         'DEALER', 'AAMRAPALI CAPITAL FINANCE'),
('434', 'Sunday', 'B.COM',                                         'Graduation',      NULL, NULL),
('440', 'Sunday', NULL,                                            NULL,              NULL, NULL),
('441', 'Sunday', 'B.COM',                                         'Graduation',      'RMS-EXECUTIVE', 'MONARCH NETWORTH CAP LTD'),
('442', 'Sunday', NULL,                                            NULL,              NULL, NULL),
('448', 'Sunday', 'Advanced diploma in Dredging technology',       'Diploma',         'Manager-IT', 'RCSPL Share broking PVT LTD'),
('605', 'Sunday', 'Bachelor of Business Adminsitration',           'Graduation',      'Receptionist', 'Divya Bhaskar'),
('611', 'Sunday', 'B.COM',                                         'Graduation',      'Assistant compliance officer', 'Amrapali Capital & Finance Services Ltd'),
('613', 'Sunday', 'B.COM',                                         'Graduation',      NULL, NULL),
('615', 'Sunday', 'B.COM',                                         'Graduation',      'Junior Accountant', 'Beeline broking limited'),
('618', 'Sunday', 'B.COM',                                         'Graduation',      'Sr Manager (Head of Operation)', 'Tipson Stock Broking Pvt Ltd'),
('628', 'Sunday', 'M.COM',                                         'Post Graduation', 'SENIOR OPERATION EXECUTIVE', 'KUNVARJI FINSTOCK PVT LTD'),
('635', NULL,     NULL,                                            NULL,              NULL, NULL),
('653', 'Sunday', 'B.A',                                           'Graduation',      'DP HEAD', 'AIRAN FINSTOCKS P LTD'),
('670', 'Sunday', 'M.COM',                                         'Post Graduation', 'TRADER', 'GOLDMINE STOCKS PVT. LTD.'),
('673', 'Sunday', 'Bachelor of Commerce Vocational',               'Graduation',      'SENIOR EXECUTIVE', 'I PLUS FINANCIAL SERVICES LLP'),
('683', NULL,     NULL,                                            NULL,              NULL, NULL),
('687', NULL,     NULL,                                            NULL,              NULL, NULL),
('698', 'Sunday', 'B.COM',                                         'Graduation',      NULL, NULL),
('699', 'Sunday', NULL,                                            NULL,              'Sr. Audit Executive', 'VKJD & ASSOCIATES'),
('803', NULL,     NULL,                                            NULL,              NULL, NULL),
('805', NULL,     NULL,                                            NULL,              NULL, NULL),
('807', NULL,     NULL,                                            NULL,              NULL, NULL);

DO $$
DECLARE
  v_org_id  BIGINT := 1;
  v_ho_id   BIGINT;
  n_staged  INT; n_target INT; n_wo INT; n_q INT; n_x INT;
  r         RECORD;
BEGIN
  SELECT id INTO v_ho_id FROM branches WHERE org_id = v_org_id AND code = 'MAIN';
  IF v_ho_id IS NULL THEN
    RAISE EXCEPTION 'ABORT: HO branch (code MAIN) not found for org %.', v_org_id;
  END IF;

  CREATE TEMP TABLE _ho_bf_target ON COMMIT DROP AS
  SELECT u.id AS user_id, b.*
  FROM _ho_bf b
  JOIN users u ON u.organization_id = v_org_id AND u.employee_id = b.emp_id
  WHERE u.branch_id = v_ho_id;

  SELECT COUNT(*) INTO n_staged FROM _ho_bf;
  SELECT COUNT(*) INTO n_target FROM _ho_bf_target;
  RAISE NOTICE 'staged=% | eligible (on HO)=%', n_staged, n_target;

  FOR r IN
    SELECT b.emp_id, COALESCE(u.name,'(not in DB)') AS name, COALESCE(br.name,'(no branch)') AS branch
    FROM _ho_bf b
    LEFT JOIN users u ON u.organization_id = v_org_id AND u.employee_id = b.emp_id
    LEFT JOIN branches br ON br.id = u.branch_id
    WHERE b.emp_id NOT IN (SELECT emp_id FROM _ho_bf_target)
    ORDER BY b.emp_id::INT
  LOOP
    RAISE NOTICE '  SKIPPED % % — branch "%" (not on HO, or not in the DB)', r.emp_id, r.name, r.branch;
  END LOOP;

  -- 1. WEEKLY OFF — only where empty
  UPDATE users u SET weekly_off_day = t.weekly_off
  FROM _ho_bf_target t
  WHERE u.id = t.user_id AND t.weekly_off IS NOT NULL
    AND (u.weekly_off_day IS NULL OR btrim(u.weekly_off_day) = '');
  GET DIAGNOSTICS n_wo = ROW_COUNT;

  -- 2. QUALIFICATION — only if the employee has none
  INSERT INTO employee_qualifications
    (user_id, organization_id, degree_level, specialization, education_country, result_type, updated_at)
  SELECT t.user_id, v_org_id, t.qual_level, t.qual, 'India', 'percentage', NOW()
  FROM _ho_bf_target t
  WHERE t.qual IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM employee_qualifications q WHERE q.user_id = t.user_id);
  GET DIAGNOSTICS n_q = ROW_COUNT;

  -- 3. PREVIOUS EMPLOYMENT — only if the employee has none; no dates invented
  INSERT INTO employee_experiences
    (user_id, organization_id, company_name, designation, updated_at)
  SELECT t.user_id, v_org_id, t.prev_company, t.prev_desig, NOW()
  FROM _ho_bf_target t
  WHERE t.prev_company IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM employee_experiences e WHERE e.user_id = t.user_id);
  GET DIAGNOSTICS n_x = ROW_COUNT;

  RAISE NOTICE 'RESULT: weekly_off set=% | qualifications inserted=% | experiences inserted=%', n_wo, n_q, n_x;
  RAISE NOTICE 'Expected: up to weekly_off 27 | up to qualifications 19 | up to experiences 13 (fewer = already filled, already has a record, or employee skipped).';
END;
$$;

-- ────────────────────────────────────────────────────────────
-- REVIEW QUERIES
-- ────────────────────────────────────────────────────────────
SELECT u.employee_id, u.name, u.weekly_off_day,
       q.degree_level, q.specialization,
       e.designation AS prev_designation, e.company_name AS prev_company
FROM   users u
LEFT   JOIN employee_qualifications q ON q.user_id = u.id
LEFT   JOIN employee_experiences   e ON e.user_id = u.id
WHERE  u.organization_id = 1 AND u.employee_id IN (SELECT emp_id FROM _ho_bf)
ORDER  BY u.employee_id::INT;

-- Must be unchanged by this file: total HO headcount
SELECT b.name, COUNT(u.id) AS employees FROM branches b
LEFT JOIN users u ON u.branch_id = b.id WHERE b.org_id = 1 GROUP BY b.name ORDER BY b.name;

-- COMMIT;   -- when satisfied
-- ROLLBACK; -- to cancel
