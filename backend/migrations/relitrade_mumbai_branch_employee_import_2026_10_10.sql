-- ============================================================
-- relitrade_mumbai_branch_employee_import_2026_10_10.sql
--
-- Purpose:
--   Relitrade (org_id = 1) — add a 5th branch "Mumbai" (code MUM) and import
--   the 4 employees of the client's Mumbai export (Mubai.csv):
--     912 Birendra Kumal | 1909 Pallavi Khanolkar | 1910 Ritesh Gogri | 1911 Jyotsna Sane
--
--   (These same 4 were wrongly put on HO on 2026-10-01 and removed by
--    relitrade_ho_remove_non_ahmedabad_2026_10_01.sql — so they should not exist now.)
--
--   Steps: 1 create branch  2 existing check  3 insert employees
--          4 reporting_to / hod  5 bank accounts
--          Part 2: religion, height/weight, emergency contact, family, nominees, driving licence,
--                  weekly off, qualification, previous employment
--
--   Run-once safety: an active branch with code MUM / name Mumbai is reused (no duplicate branch
--   is created); a SOFT-DELETED match aborts the file; if any of the 4 employees already exists
--   (employee_id or device_enrollment_id) the file aborts and rolls everything back.
--
--   Not touched: attendance, leaves, payslips, payroll, other branches, HO employees.
--   Deliberately NOT created (client decision 2026-10-10): leave policies, holidays,
--   work schedules, HR Admin assignments, biometric device / biometric_employee_map /
--   device_enrollment_id. Mumbai has no biometric setup yet.
--   Not imported: shift (8:45-5:00 / 9:00-6:00).
--
--   Column mapping for the 3 extra fields (see education.routes.js / experience.routes.js):
--     WeeklyOffDay 'Sunday' (1911)  -> users.weekly_off_day. PROFILE DATA ONLY: attendance and
--                                      payroll do not read it; real weekly offs come from the
--                                      branch/org work schedule (not changed here).
--     Qualification (1909 B.Sc, 1910 B.COM) -> employee_qualifications.specialization = source text,
--                                      degree_level = 'Graduation' (fixed UI category list).
--                                      No dedicated degree-name column exists; institution stays NULL.
--     Experience "DEALER In (TALISMAN SEC PVT LTD)" -> employee_experiences.designation = 'DEALER',
--                                      company_name = 'TALISMAN SEC PVT LTD'. No dates invented.
--
-- HOW TO EXECUTE (this file never commits on its own):
--   1. DRY RUN — run it exactly like this and read every NOTICE and SELECT result:
--        psql -v ON_ERROR_STOP=1 -f relitrade_mumbai_branch_employee_import_2026_10_10.sql
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

CREATE TEMP TABLE _mum_stage (
  emp_id   TEXT, sal TEXT, name TEXT, dept TEXT, pos TEXT,
  doj      DATE, grade TEXT, phone TEXT, gender TEXT, dob DATE, blood TEXT,
  email    TEXT, marital TEXT,
  addr     TEXT, city TEXT, state TEXT, pin TEXT,
  pan      TEXT, aadhar TEXT, uan TEXT,
  bank     TEXT, bbranch TEXT, acct TEXT, ifsc TEXT, atype TEXT,
  pt BOOLEAN, ptrule TEXT, esi BOOLEAN, pf BOOLEAN,
  conf     DATE, probm INTEGER, sup TEXT, hod TEXT
) ON COMMIT DROP;

-- Personal email used as login email when free; else empNNN@relitrade.in placeholder.
-- Dates in the export are dd-mm-yy (912 DOB 03-05-07 = 2007-05-03).
INSERT INTO _mum_stage VALUES
('912','Mr','Birendra Kumal','Admin','Office Boy','2026-02-22','B','8451049300','Male','2007-05-03',NULL,'veerukumal909@gmail.com','Single','Lallubhai compound A-56, Shri Ganesh Krupa Chawl, Annabhau Sathe Nagar, Mankhurd West','MUMBAI','MAHARASHTRA',NULL,NULL,'930941634803',NULL,'Kotak Bank','Mumbai Sion','2052405857','KKBK0000635','savings',FALSE,NULL,FALSE,FALSE,'2026-02-22',NULL,'401','401'),
('1909','Ms','Pallavi Kashiram Khanolkar','Dealing','Dealer','2022-05-10','B','9867297222','Female','1977-02-01','O+','pallavi_khanolkar@yahoo.com','Single','A/24, 3rd Flr, Krishnai Niwas Bldg, Kopar Rd, Dombivli (W), Near Santoshi Mata Mandir','THANE','MAHARASHTRA','421202','ARXPK5434G','939810596687',NULL,'Kotak Bank','Dombivali','3247673082','KKBK0000628','savings',TRUE,'MAHARASHTRA',FALSE,FALSE,'2022-05-10',NULL,'401','401'),
('1910','Mr','Ritesh Dhirajlal Gogri','Dealing','Dealer','2022-05-23','B','9004846434','Male','1983-10-07','O+','riteshgogri83@gmail.com','Single','H/304, Briza, Anchor Park, Evershine City Last Stop, Near Water Tank, Vasai East','VIRAR','MAHARASHTRA','401208','AJNPG8845K','790565608535',NULL,'Kotak Bank','Vasai Manikpur','3247673068','KKBK0000659','savings',TRUE,'MAHARASHTRA',FALSE,FALSE,'2022-05-23',NULL,'401','401'),
('1911','Ms','Jyotsna Ramesh Sane','Back Office','Executive','2022-06-01','B','8422089817','Female','2002-10-14','AB+','jyotsnasane71@gmail.com','Single','Mahatma Gandhi Nagar Rahivashi Sangh, M.G. Road, Tata Power Lane, Opp Municipal School, Dharavi, Mumbai','MUMBAI','MAHARASHTRA','400017','NMPPS6177E','301807667379',NULL,'Kotak Bank','Mumbai','3247673044','KKBK0000958','savings',TRUE,'MAHARASHTRA',FALSE,FALSE,'2022-06-01',NULL,'401','401');

CREATE TEMP TABLE _mum_new (user_id BIGINT, emp_id TEXT) ON COMMIT DROP;

DO $$
DECLARE
  v_org_id    BIGINT := 1;
  v_mum_id    BIGINT;
  v_staged    INTEGER;
  v_existing  INTEGER;
  v_inserted  INTEGER;
  r           RECORD;
BEGIN
  RAISE NOTICE '=== relitrade_mumbai_branch_employee_import_2026_10_10 — START ===';

  -- STEP 1: BRANCH
  -- Abort if a matching branch was soft-deleted (hidden). to_jsonb() keeps this valid even if
  -- branches.deleted_at does not exist in this schema (then the key is simply absent -> NULL).
  IF EXISTS (SELECT 1 FROM branches b
             WHERE b.org_id = v_org_id
               AND (upper(btrim(b.code)) = 'MUM' OR lower(btrim(b.name)) = 'mumbai')
               AND to_jsonb(b)->>'deleted_at' IS NOT NULL) THEN
    RAISE EXCEPTION 'ABORT: a soft-deleted Mumbai / MUM branch exists for org %. Restore or rename it first; importing would attach employees to a hidden branch.', v_org_id;
  END IF;

  SELECT b.id INTO v_mum_id FROM branches b
  WHERE b.org_id = v_org_id
    AND (upper(btrim(b.code)) = 'MUM' OR lower(btrim(b.name)) = 'mumbai')
  ORDER BY b.id LIMIT 1;
  IF v_mum_id IS NULL THEN
    INSERT INTO branches (org_id, name, code, location, address, is_active)
    VALUES (v_org_id, 'Mumbai', 'MUM', 'Mumbai', 'Mumbai, Maharashtra', TRUE)
    RETURNING id INTO v_mum_id;
    RAISE NOTICE 'STEP 1: branch "Mumbai" created — id=%', v_mum_id;
  ELSE
    RAISE NOTICE 'STEP 1: branch "Mumbai" already exists — id=%', v_mum_id;
  END IF;

  -- STEP 2: WHO ALREADY EXISTS?
  SELECT COUNT(*) INTO v_staged FROM _mum_stage;
  SELECT COUNT(*) INTO v_existing FROM _mum_stage s
  WHERE EXISTS (SELECT 1 FROM users u WHERE u.organization_id = v_org_id
                AND (u.employee_id = s.emp_id OR u.device_enrollment_id = s.emp_id));
  -- Safety: the 4 were removed from HO on 2026-10-01; seeing any is unexpected, so stop.
  IF v_existing > 0 THEN
    RAISE EXCEPTION 'ABORT: % of the 4 Mumbai employees already exist in org %. Investigate before importing.', v_existing, v_org_id;
  END IF;
  RAISE NOTICE 'STEP 2: % in file; % already exist; % new.', v_staged, v_existing, v_staged - v_existing;

  FOR r IN
    SELECT s.emp_id, s.name, COALESCE(b.name,'(no branch)') AS cur_branch
    FROM _mum_stage s
    JOIN users u ON u.organization_id = v_org_id
                AND (u.employee_id = s.emp_id OR u.device_enrollment_id = s.emp_id)
    LEFT JOIN branches b ON b.id = u.branch_id
  LOOP
    RAISE NOTICE '  already exists: % % -> branch "%"', r.emp_id, r.name, r.cur_branch;
  END LOOP;

  -- STEP 3: INSERT MISSING EMPLOYEES
  WITH ins AS (
    INSERT INTO users (
      name, email, password, role, organization_id,
      employee_id, salutation, gender, date_of_birth, blood_group,
      department, position, grade, pay_cadre, salary_structure, salary_on,
      employment_type, employment_status, date_of_joining, joining_date, confirmation_date,
      phone, personal_email, marital_status, nationality,
      current_address_line1, current_city, current_state, current_country, current_postal_code,
      pan_number, aadhar_no, uan_no,
      bank_name, bank_account_number, bank_ifsc,
      probation_applicable, probation_months,
      pt_applicable, pt_rule, pf_applicable, esi_applicable,
      division, branch_id, device_enrollment_id,
      avatar_color, force_password_change
    )
    SELECT
      s.name,
      CASE WHEN s.email IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM users x WHERE lower(x.email) = lower(s.email))
           THEN lower(s.email)
           ELSE 'emp' || s.emp_id || '@relitrade.in' END,
      '$2a$10$jmYpe0h87c.K1D5Kns9h.eKZfI6rzuPn8/b/4/M1n1VOmSViWQx6u',
      'employee', v_org_id,
      s.emp_id, s.sal, s.gender, s.dob, s.blood,
      s.dept, s.pos, s.grade, 'Staff', 'GROSS', 'Day',
      'full-time',
      CASE WHEN s.probm IS NOT NULL AND (s.doj + (s.probm || ' months')::interval) > CURRENT_DATE
           THEN 'probation' ELSE 'active' END,
      s.doj, s.doj, s.conf,
      s.phone,
      CASE WHEN s.email IS NOT NULL AND s.email NOT ILIKE '%@relitrade.in' THEN lower(s.email) END,
      s.marital, 'Indian',
      s.addr, s.city, s.state, 'INDIA', s.pin,
      s.pan, s.aadhar, s.uan,
      s.bank, s.acct, s.ifsc,
      (s.probm IS NOT NULL), s.probm,
      s.pt, s.ptrule, s.pf, s.esi,
      'Relitrade Stock Broking Private Limited', v_mum_id, NULL,
      '#6366F1', TRUE
    FROM _mum_stage s
    WHERE NOT EXISTS (
      SELECT 1 FROM users u WHERE u.organization_id = v_org_id
        AND (u.employee_id = s.emp_id OR u.device_enrollment_id = s.emp_id)
    )
    RETURNING id, employee_id
  )
  INSERT INTO _mum_new SELECT id, employee_id FROM ins;

  SELECT COUNT(*) INTO v_inserted FROM _mum_new;
  RAISE NOTICE 'STEP 3: % new employees inserted into Mumbai.', v_inserted;

  -- STEP 4: REPORTING (401 = Karan Sanghvi on HO; unknown -> NULL; never self)
  UPDATE users u SET
    reporting_to = (SELECT x.id FROM users x WHERE x.organization_id = v_org_id
                    AND x.employee_id = s.sup AND x.employee_id <> s.emp_id LIMIT 1),
    hod_id       = (SELECT x.id FROM users x WHERE x.organization_id = v_org_id
                    AND x.employee_id = s.hod AND x.employee_id <> s.emp_id LIMIT 1)
  FROM _mum_stage s JOIN _mum_new n ON n.emp_id = s.emp_id
  WHERE u.id = n.user_id;

  -- STEP 5: BANK ACCOUNTS (new employees only)
  INSERT INTO employee_bank_accounts
    (employee_id, organization_id, bank_name, branch_name, account_number, ifsc_code,
     account_type, payment_method, is_primary, is_salary_account)
  SELECT n.user_id, v_org_id, s.bank, s.bbranch, s.acct, s.ifsc, s.atype, 'bank_transfer', TRUE, TRUE
  FROM _mum_new n JOIN _mum_stage s ON s.emp_id = n.emp_id
  WHERE s.acct IS NOT NULL AND s.bank IS NOT NULL
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'SUMMARY: Mumbai id=% | file=% | pre-existing=% | inserted=%', v_mum_id, v_staged, v_existing, v_inserted;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- PART 2: extra profile data (NEW employees only)
-- ────────────────────────────────────────────────────────────
CREATE TEMP TABLE _mum_x (
  emp_id TEXT, religion TEXT, height TEXT, weight TEXT,
  dl_no TEXT, dl_exp DATE, em_phone TEXT,
  weekly_off TEXT, qual TEXT, qual_level TEXT, prev_desig TEXT, prev_company TEXT
) ON COMMIT DROP;

INSERT INTO _mum_x VALUES
('912',NULL,NULL,NULL,NULL,NULL,'8652160789',NULL,NULL,NULL,NULL,NULL),
('1909','Hindu','5.5','63',NULL,NULL,'8879816553',NULL,'B.Sc','Graduation','DEALER','TALISMAN SEC PVT LTD'),
('1910','Jain','5.4','100','MH02 20140038059','2033-10-06','9987789807',NULL,'B.COM','Graduation','DEALER','NIRMAL BANG'),
('1911','Hindu','5.5','45',NULL,NULL,'9702871788','Sunday',NULL,NULL,NULL,NULL);

CREATE TEMP TABLE _mum_fam (emp_id TEXT, rel TEXT, name TEXT, dob DATE, occ TEXT, dep BOOLEAN) ON COMMIT DROP;
INSERT INTO _mum_fam VALUES
('1909','father','Kashiram',NULL,NULL,FALSE),
('1909','mother','Vidya',NULL,'Housewife',FALSE),
('1910','father','Dhirajlal Gogri','1948-06-20','Business',FALSE),
('1910','mother','Manjula Gogri','1954-07-18','House wife',FALSE),
('1911','father','Ramesh Baliram Sane',NULL,'Paper printing',FALSE),
('1911','mother','Roshani Ramesh Sane',NULL,'House wife',FALSE);

CREATE TEMP TABLE _mum_nom (emp_id TEXT, name TEXT, rel TEXT) ON COMMIT DROP;
INSERT INTO _mum_nom VALUES
('1909','Sudhir Desai','Brother'),
('1911','Roshani Sane','Mother');

DO $$
DECLARE
  v_org_id BIGINT := 1;
  n_x INT; n_f INT; n_n INT; n_d INT; n_q INT; n_e INT;
BEGIN
  UPDATE users u SET
    religion                = COALESCE(x.religion, u.religion),
    height                  = COALESCE(NULLIF(x.height,'0'), u.height),
    weight                  = COALESCE(NULLIF(x.weight,'0'), u.weight),
    emergency_contact_phone = COALESCE(x.em_phone, u.emergency_contact_phone),
    weekly_off_day          = COALESCE(x.weekly_off, u.weekly_off_day)
  FROM _mum_x x JOIN _mum_new n ON n.emp_id = x.emp_id
  WHERE u.id = n.user_id;
  GET DIAGNOSTICS n_x = ROW_COUNT;

  INSERT INTO employee_family_members
    (employee_id, organization_id, relationship, name, date_of_birth, occupation, dependent)
  SELECT n.user_id, v_org_id, f.rel, f.name, f.dob, f.occ, f.dep
  FROM _mum_fam f JOIN _mum_new n ON n.emp_id = f.emp_id;
  GET DIAGNOSTICS n_f = ROW_COUNT;

  INSERT INTO employee_nominees
    (employee_id, organization_id, nominee_name, relationship, percentage_share, is_primary)
  SELECT n.user_id, v_org_id, m.name, m.rel, 100, TRUE
  FROM _mum_nom m JOIN _mum_new n ON n.emp_id = m.emp_id;
  GET DIAGNOSTICS n_n = ROW_COUNT;

  INSERT INTO employee_government_documents
    (employee_id, organization_id, document_type, document_number, expiry_date)
  SELECT n.user_id, v_org_id, 'driving_license', x.dl_no, x.dl_exp
  FROM _mum_x x JOIN _mum_new n ON n.emp_id = x.emp_id
  WHERE x.dl_no IS NOT NULL
  ON CONFLICT (employee_id, document_type, organization_id) DO NOTHING;
  GET DIAGNOSTICS n_d = ROW_COUNT;

  INSERT INTO employee_qualifications
    (user_id, organization_id, degree_level, specialization, education_country, result_type, updated_at)
  SELECT n.user_id, v_org_id, x.qual_level, x.qual, 'India', 'percentage', NOW()
  FROM _mum_x x JOIN _mum_new n ON n.emp_id = x.emp_id
  WHERE x.qual IS NOT NULL;
  GET DIAGNOSTICS n_q = ROW_COUNT;

  INSERT INTO employee_experiences
    (user_id, organization_id, company_name, designation, updated_at)
  SELECT n.user_id, v_org_id, x.prev_company, x.prev_desig, NOW()
  FROM _mum_x x JOIN _mum_new n ON n.emp_id = x.emp_id
  WHERE x.prev_company IS NOT NULL;
  GET DIAGNOSTICS n_e = ROW_COUNT;

  RAISE NOTICE 'PART 2: users updated=% | family=% | nominees=% | driving licences=% | qualifications=% | experiences=%', n_x, n_f, n_n, n_d, n_q, n_e;
  RAISE NOTICE 'Expected: users 4 | family 6 | nominees 2 | driving licences 1 | qualifications 2 | experiences 2';
END;
$$;

-- ────────────────────────────────────────────────────────────
-- REVIEW QUERIES
-- ────────────────────────────────────────────────────────────
SELECT id, name, code, location, is_active FROM branches WHERE org_id = 1 ORDER BY id;   -- expect 5 rows

SELECT u.employee_id, u.name, u.weekly_off_day, q.specialization AS qualification, e.designation AS prev_desig, e.company_name AS prev_company
FROM   users u
LEFT   JOIN employee_qualifications q ON q.user_id = u.id
LEFT   JOIN employee_experiences   e ON e.user_id = u.id
WHERE  u.organization_id = 1 AND u.employee_id IN (SELECT emp_id FROM _mum_stage)
ORDER  BY u.employee_id::INT;

SELECT u.employee_id, u.name, u.department, u.position, u.employment_status,
       b.name AS branch, u.email, u.pt_applicable, u.pt_rule
FROM   users u LEFT JOIN branches b ON b.id = u.branch_id
WHERE  u.organization_id = 1 AND u.employee_id IN (SELECT emp_id FROM _mum_stage)
ORDER  BY u.employee_id::INT;

-- HO untouched: count must equal the pre-run HO count
SELECT b.name, COUNT(u.id) AS employees FROM branches b
LEFT JOIN users u ON u.branch_id = b.id WHERE b.org_id = 1 GROUP BY b.name ORDER BY b.name;

-- COMMIT;   -- when satisfied
-- ROLLBACK; -- to cancel
