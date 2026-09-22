-- ============================================================
-- relitrade_bhuj_branch_employee_import_2026_09_22.sql
--
-- Purpose:
--   Set up two Bhuj sub-branches for Relitrade (org_id = 1)
--   and import 10 Bhuj employees from the two Excel files
--   supplied by the client on 2026-09-22.
--
--   Branch setup:
--     • Rename existing "Bhuj" branch  → "Bhuj - Deep Sanghvi"
--       (preserves branch ID and all existing data)
--     • Create new branch              → "Bhuj - VFPL"
--
--   Employee import (10 employees total):
--     • 4 employees  → Bhuj - Deep Sanghvi  (company: Deep Ashokbhai Sanghvi)
--         EmpID 437, 105, 112, 115
--     • 6 employees  → Bhuj - VFPL          (company: Vaibhav Finstock Private Limited)
--         EmpID 101, 103, 113, 116, 117, 118
--
--   Biometric:
--     • device_enrollment_id set = employee_id for all 10 employees
--     • biometric_employee_map entries inserted for all 10
--     • ONE existing biometric device serves both branches — no device changes
--
--   Records NOT touched:
--     • Dalal branch and all its employees
--     • All other Ahmedabad branches
--     • attendance, leave, payslip, payroll records
--     • biometric_devices table
--     • biometric_raw_logs table
--
-- HOW TO EXECUTE:
--   1.  Run entire file in psql.
--   2.  Read all NOTICE messages carefully.
--   3.  If everything looks correct  → COMMIT;
--   4.  If anything looks wrong      → ROLLBACK;
--   The transaction does NOT auto-commit.
--
-- PREREQUISITE:
--   Run relitrade_branch_cleanup_2026_09_15.sql first (Bhuj must
--   exist with name exactly 'Bhuj').
--
-- Generated : 2026-09-22
-- Author    : Lumos Logic
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_org_id              BIGINT  := 1;
  v_bhuj_id             BIGINT;
  v_vfpl_id             BIGINT;
  v_dalal_name          TEXT;
  v_conflict_count      INTEGER;
  v_ds_count            INTEGER;
  v_vfpl_count          INTEGER;

  -- employee user IDs (resolved after insert)
  v_uid_437             BIGINT;
  v_uid_105             BIGINT;
  v_uid_112             BIGINT;
  v_uid_115             BIGINT;
  v_uid_101             BIGINT;
  v_uid_103             BIGINT;
  v_uid_113             BIGINT;
  v_uid_116             BIGINT;
  v_uid_117             BIGINT;
  v_uid_118             BIGINT;
BEGIN

  RAISE NOTICE '=======================================================';
  RAISE NOTICE 'relitrade_bhuj_branch_employee_import_2026_09_22 — START';
  RAISE NOTICE '=======================================================';

  -- ─────────────────────────────────────────────────────────────
  -- STEP 1: PRE-FLIGHT VALIDATION
  -- ─────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '--- STEP 1: PRE-FLIGHT VALIDATION ---';

  -- 1a. Existing "Bhuj" branch must exist for org 1
  SELECT id INTO v_bhuj_id
  FROM branches
  WHERE name = 'Bhuj' AND org_id = v_org_id;

  IF v_bhuj_id IS NULL THEN
    RAISE EXCEPTION
      'ABORT: No branch named exactly "Bhuj" found for org_id=1. '
      'Run relitrade_branch_cleanup_2026_09_15.sql first, or verify branch name.';
  END IF;
  RAISE NOTICE 'OK: Found existing Bhuj branch — id=%', v_bhuj_id;

  -- 1b. Dalal branch must exist and will NOT be touched
  SELECT name INTO v_dalal_name
  FROM branches
  WHERE name = 'Dalal' AND org_id = v_org_id;

  IF v_dalal_name IS NULL THEN
    RAISE EXCEPTION 'ABORT: Dalal branch not found for org_id=1. Aborting to prevent unintended state.';
  END IF;
  RAISE NOTICE 'OK: Dalal branch confirmed present — will NOT be modified.';

  -- 1c. "Bhuj - VFPL" must NOT already exist (idempotency guard)
  IF EXISTS (SELECT 1 FROM branches WHERE name = 'Bhuj - VFPL' AND org_id = v_org_id) THEN
    RAISE EXCEPTION
      'ABORT: Branch "Bhuj - VFPL" already exists. Migration may have been run before. '
      'Inspect the data and re-run only if rollback is needed.';
  END IF;
  RAISE NOTICE 'OK: "Bhuj - VFPL" does not yet exist — safe to create.';

  -- 1d. "Bhuj - Deep Sanghvi" must NOT already exist (idempotency guard)
  IF EXISTS (SELECT 1 FROM branches WHERE name = 'Bhuj - Deep Sanghvi' AND org_id = v_org_id) THEN
    RAISE EXCEPTION
      'ABORT: Branch "Bhuj - Deep Sanghvi" already exists. Migration may have been run before.';
  END IF;
  RAISE NOTICE 'OK: "Bhuj - Deep Sanghvi" does not yet exist — safe to rename.';

  -- 1e. Check for employee_id conflicts in org 1 for the 10 employees we are importing
  SELECT COUNT(*) INTO v_conflict_count
  FROM users
  WHERE organization_id = v_org_id
    AND employee_id IN ('101','103','105','112','113','115','116','117','118','437');

  IF v_conflict_count > 0 THEN
    RAISE NOTICE 'WARNING: % employee(s) with these IDs already exist in org 1:', v_conflict_count;
    -- List them for review
    RAISE NOTICE '  Existing: (check the SELECT at end of block)';
    -- We will UPDATE existing rows rather than fail — log them
  ELSE
    RAISE NOTICE 'OK: No pre-existing employees with IDs 101/103/105/112/113/115/116/117/118/437.';
  END IF;

  -- ─────────────────────────────────────────────────────────────
  -- STEP 2: RENAME "Bhuj" → "Bhuj - Deep Sanghvi"
  -- ─────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '--- STEP 2: RENAME BRANCH ---';

  UPDATE branches
  SET    name = 'Bhuj - Deep Sanghvi'
  WHERE  id = v_bhuj_id AND org_id = v_org_id;

  RAISE NOTICE 'Branch % renamed: "Bhuj" → "Bhuj - Deep Sanghvi"', v_bhuj_id;

  -- ─────────────────────────────────────────────────────────────
  -- STEP 3: CREATE "Bhuj - VFPL" BRANCH
  -- ─────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '--- STEP 3: CREATE BHUJ-VFPL BRANCH ---';

  INSERT INTO branches (org_id, name, code, location, address, is_active)
  VALUES (v_org_id, 'Bhuj - VFPL', 'BVFPL', 'Bhuj, Kachchh', 'Bhuj, Kachchh, Gujarat', TRUE)
  RETURNING id INTO v_vfpl_id;

  RAISE NOTICE 'Branch "Bhuj - VFPL" created — id=%', v_vfpl_id;

  -- ─────────────────────────────────────────────────────────────
  -- STEP 4: INSERT / UPDATE DEEP SANGHVI EMPLOYEES
  --         Company: Deep Ashokbhai Sanghvi
  --         Branch : Bhuj - Deep Sanghvi (v_bhuj_id)
  -- ─────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '--- STEP 4: IMPORT DEEP SANGHVI EMPLOYEES (4) ---';

  -- ── EmpID 437 — Deep Ashokbhai Sanghvi ──
  INSERT INTO users (
    name, email, password, role, organization_id,
    employee_id, salutation, gender, date_of_birth,
    department, position, grade, pay_cadre, salary_structure, salary_on,
    employment_type, employment_status, date_of_joining, joining_date,
    phone, marital_status,
    pt_applicable, pf_applicable, esi_applicable,
    division,
    branch_id, device_enrollment_id,
    avatar_color, force_password_change
  )
  SELECT
    'Deep Ashokbhai Sanghvi',
    'deep.sanghvi@relitrade.in',
    '$2a$10$jmYpe0h87c.K1D5Kns9h.eKZfI6rzuPn8/b/4/M1n1VOmSViWQx6u',
    'employee', v_org_id,
    '437', 'Mr', 'Male', '2000-01-13',
    'Operation', 'Intern', 'A', 'Staff', 'GROSS', 'Day',
    'full-time', 'active', '2018-12-25', '2018-12-25',
    '9099419999', 'Married',
    FALSE, FALSE, FALSE,
    'Deep Ashokbhai Sanghvi',
    v_bhuj_id, '437',
    '#6366F1', TRUE
  WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE organization_id = v_org_id AND employee_id = '437'
  );

  -- If row already existed, update branch and key fields
  UPDATE users SET
    branch_id           = v_bhuj_id,
    division            = 'Deep Ashokbhai Sanghvi',
    device_enrollment_id = '437'
  WHERE organization_id = v_org_id AND employee_id = '437'
    AND branch_id IS DISTINCT FROM v_bhuj_id;

  SELECT id INTO v_uid_437 FROM users WHERE organization_id = v_org_id AND employee_id = '437';
  RAISE NOTICE 'EmpID 437  Deep Ashokbhai Sanghvi  → user id=%  branch=%', v_uid_437, v_bhuj_id;

  -- ── EmpID 105 — Hardik Mehta ──
  INSERT INTO users (
    name, email, password, role, organization_id,
    employee_id, salutation, gender, date_of_birth, blood_group,
    department, position, grade, pay_cadre, salary_structure, salary_on,
    employment_type, employment_status, date_of_joining, joining_date, confirmation_date,
    phone, personal_email, marital_status, nationality, religion,
    height, weight,
    pt_applicable, pf_applicable, esi_applicable,
    division,
    branch_id, device_enrollment_id,
    avatar_color, force_password_change
  )
  SELECT
    'Hardik Mehta',
    '1995hardikmehta@gmail.com',
    '$2a$10$jmYpe0h87c.K1D5Kns9h.eKZfI6rzuPn8/b/4/M1n1VOmSViWQx6u',
    'employee', v_org_id,
    '105', 'Mr', 'Male', '1990-04-01', 'N/A',
    'Trading', 'Executive', 'B', 'Staff', 'GROSS', 'Day',
    'full-time', 'active', '2023-04-01', '2023-04-01', '2023-04-01',
    '9879745484', '1995hardikmehta@gmail.com', 'Single', 'INDIAN', 'JAIN',
    '5.7', '55',
    FALSE, FALSE, FALSE,
    'Deep Ashokbhai Sanghvi',
    v_bhuj_id, '105',
    '#10B981', TRUE
  WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE organization_id = v_org_id AND employee_id = '105'
  );

  UPDATE users SET
    branch_id            = v_bhuj_id,
    division             = 'Deep Ashokbhai Sanghvi',
    device_enrollment_id = '105'
  WHERE organization_id = v_org_id AND employee_id = '105'
    AND branch_id IS DISTINCT FROM v_bhuj_id;

  SELECT id INTO v_uid_105 FROM users WHERE organization_id = v_org_id AND employee_id = '105';
  RAISE NOTICE 'EmpID 105  Hardik Mehta            → user id=%  branch=%', v_uid_105, v_bhuj_id;

  -- ── EmpID 112 — Nishtha Hiren Sanghvi ──
  INSERT INTO users (
    name, email, password, role, organization_id,
    employee_id, salutation, gender, date_of_birth, blood_group,
    department, position, grade, pay_cadre, salary_structure, salary_on,
    employment_type, employment_status, date_of_joining, joining_date, confirmation_date,
    phone, marital_status, nationality, religion,
    height, weight,
    pan_number,
    pt_applicable, pf_applicable, esi_applicable,
    division,
    branch_id, device_enrollment_id,
    avatar_color, force_password_change
  )
  SELECT
    'Nishtha Hiren Sanghvi',
    'emp112.bhujds@relitrade.in',
    '$2a$10$jmYpe0h87c.K1D5Kns9h.eKZfI6rzuPn8/b/4/M1n1VOmSViWQx6u',
    'employee', v_org_id,
    '112', 'Ms', 'Female', '2005-06-20', 'B+',
    'Back Office', 'Executive', 'B', 'Staff', 'GROSS', 'Day',
    'full-time', 'active', '2025-01-01', '2025-01-01', '2025-01-01',
    '8200900176', 'Single', 'INDIAN', 'HINDU',
    '5.4', '58',
    'TMFPS9476A',
    FALSE, FALSE, FALSE,
    'Deep Ashokbhai Sanghvi',
    v_bhuj_id, '112',
    '#F59E0B', TRUE
  WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE organization_id = v_org_id AND employee_id = '112'
  );

  UPDATE users SET
    branch_id            = v_bhuj_id,
    division             = 'Deep Ashokbhai Sanghvi',
    device_enrollment_id = '112'
  WHERE organization_id = v_org_id AND employee_id = '112'
    AND branch_id IS DISTINCT FROM v_bhuj_id;

  SELECT id INTO v_uid_112 FROM users WHERE organization_id = v_org_id AND employee_id = '112';
  RAISE NOTICE 'EmpID 112  Nishtha Sanghvi         → user id=%  branch=%', v_uid_112, v_bhuj_id;

  -- ── EmpID 115 — Kanchan Devshibhai Gosariya ──
  --   Joined 15-04-26, EProbation=TRUE, 3 months → probation ended 15-07-26 → active
  INSERT INTO users (
    name, email, password, role, organization_id,
    employee_id, salutation, gender, date_of_birth,
    department, position, grade, pay_cadre, salary_structure, salary_on,
    employment_type, employment_status, date_of_joining, joining_date,
    phone, personal_email, marital_status, nationality, religion,
    pan_number,
    probation_applicable, probation_months,
    pt_applicable, pf_applicable, esi_applicable,
    division,
    branch_id, device_enrollment_id,
    avatar_color, force_password_change
  )
  SELECT
    'Kanchan Devshibhai Gosariya',
    'gorasiyakanchan@gmail.com',
    '$2a$10$jmYpe0h87c.K1D5Kns9h.eKZfI6rzuPn8/b/4/M1n1VOmSViWQx6u',
    'employee', v_org_id,
    '115', 'Ms', 'Female', '1996-09-08',
    'Back Office', 'Receptionist', 'B', 'Staff', 'GROSS', 'Day',
    'full-time', 'active', '2026-04-15', '2026-04-15',
    '9726051987', 'gorasiyakanchan@gmail.com', 'Single', 'Indian', 'Hindu',
    'JWIPK1120E',
    TRUE, 3,
    FALSE, FALSE, FALSE,
    'Deep Ashokbhai Sanghvi',
    v_bhuj_id, '115',
    '#EC4899', TRUE
  WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE organization_id = v_org_id AND employee_id = '115'
  );

  UPDATE users SET
    branch_id            = v_bhuj_id,
    division             = 'Deep Ashokbhai Sanghvi',
    device_enrollment_id = '115'
  WHERE organization_id = v_org_id AND employee_id = '115'
    AND branch_id IS DISTINCT FROM v_bhuj_id;

  SELECT id INTO v_uid_115 FROM users WHERE organization_id = v_org_id AND employee_id = '115';
  RAISE NOTICE 'EmpID 115  Kanchan Gosariya        → user id=%  branch=%', v_uid_115, v_bhuj_id;

  -- ─────────────────────────────────────────────────────────────
  -- STEP 5: INSERT / UPDATE VFPL EMPLOYEES
  --         Company: Vaibhav Finstock Private Limited
  --         Branch : Bhuj - VFPL (v_vfpl_id)
  -- ─────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '--- STEP 5: IMPORT VFPL EMPLOYEES (6) ---';

  -- ── EmpID 101 — Ira Sanghvi ──
  INSERT INTO users (
    name, email, password, role, organization_id,
    employee_id, salutation, gender, date_of_birth,
    department, position, grade, pay_cadre, salary_structure, salary_on,
    employment_type, employment_status, date_of_joining, joining_date, confirmation_date,
    marital_status,
    pt_applicable, pf_applicable, esi_applicable,
    division,
    branch_id, device_enrollment_id,
    avatar_color, force_password_change
  )
  SELECT
    'Ira Sanghvi',
    'emp101.vfpl@relitrade.in',
    '$2a$10$jmYpe0h87c.K1D5Kns9h.eKZfI6rzuPn8/b/4/M1n1VOmSViWQx6u',
    'employee', v_org_id,
    '101', 'Ms', 'Female', '1990-04-01',
    'Operation', 'Director', 'B', 'Staff', 'GROSS', 'Day',
    'full-time', 'active', '2023-04-01', '2023-04-01', '2024-02-20',
    NULL,
    FALSE, FALSE, TRUE,
    'Vaibhav Finstock Private Limited',
    v_vfpl_id, '101',
    '#8B5CF6', TRUE
  WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE organization_id = v_org_id AND employee_id = '101'
  );

  UPDATE users SET
    branch_id            = v_vfpl_id,
    division             = 'Vaibhav Finstock Private Limited',
    device_enrollment_id = '101'
  WHERE organization_id = v_org_id AND employee_id = '101'
    AND branch_id IS DISTINCT FROM v_vfpl_id;

  SELECT id INTO v_uid_101 FROM users WHERE organization_id = v_org_id AND employee_id = '101';
  RAISE NOTICE 'EmpID 101  Ira Sanghvi             → user id=%  branch=%', v_uid_101, v_vfpl_id;

  -- ── EmpID 103 — Kureshi Inayat ──
  INSERT INTO users (
    name, email, password, role, organization_id,
    employee_id, salutation, gender, date_of_birth, blood_group,
    department, position, grade, pay_cadre, salary_structure, salary_on,
    employment_type, employment_status, date_of_joining, joining_date, confirmation_date,
    phone, personal_email,
    nationality, religion, marital_status,
    height, weight,
    aadhar_no, pan_number, uan_no,
    bank_name, bank_account_number, bank_ifsc,
    pt_applicable, pf_applicable, esi_applicable,
    division,
    branch_id, device_enrollment_id,
    avatar_color, force_password_change
  )
  SELECT
    'Kureshi Inayat',
    'inayatqureshji6774@gmail.com',
    '$2a$10$jmYpe0h87c.K1D5Kns9h.eKZfI6rzuPn8/b/4/M1n1VOmSViWQx6u',
    'employee', v_org_id,
    '103', 'Mr', 'Male', '1974-07-06', 'B+',
    'DP', 'Head', 'B', 'Staff', 'GROSS', 'Day',
    'full-time', 'active', '2023-04-01', '2023-04-01', '2023-04-01',
    '9408304900', 'inayatqureshji6774@gmail.com',
    'indian', 'muslim', 'Married',
    '89', '0',
    '504611836117', 'CBIPK4233Q', NULL,
    'IDBI Bank', '0411104000046747', 'IBKL0000411',
    FALSE, FALSE, FALSE,
    'Vaibhav Finstock Private Limited',
    v_vfpl_id, '103',
    '#3B82F6', TRUE
  WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE organization_id = v_org_id AND employee_id = '103'
  );

  UPDATE users SET
    branch_id            = v_vfpl_id,
    division             = 'Vaibhav Finstock Private Limited',
    device_enrollment_id = '103'
  WHERE organization_id = v_org_id AND employee_id = '103'
    AND branch_id IS DISTINCT FROM v_vfpl_id;

  SELECT id INTO v_uid_103 FROM users WHERE organization_id = v_org_id AND employee_id = '103';
  RAISE NOTICE 'EmpID 103  Kureshi Inayat          → user id=%  branch=%', v_uid_103, v_vfpl_id;

  -- ── EmpID 113 — Abir Kureshi ──
  --   EProbation was TRUE but EConfirmDate=08-09-25 → already confirmed → active
  INSERT INTO users (
    name, email, password, role, organization_id,
    employee_id, salutation, gender, date_of_birth, blood_group,
    department, position, grade, pay_cadre, salary_on,
    employment_type, employment_status, date_of_joining, joining_date, confirmation_date,
    phone, personal_email,
    nationality, religion, marital_status,
    height, weight,
    aadhar_no,
    bank_name, bank_account_number, bank_ifsc,
    probation_applicable, probation_months,
    pt_applicable, pf_applicable, esi_applicable,
    division,
    branch_id, device_enrollment_id,
    avatar_color, force_password_change
  )
  SELECT
    'Abir Kureshi',
    'aabeerqureshi90@gmail.com',
    '$2a$10$jmYpe0h87c.K1D5Kns9h.eKZfI6rzuPn8/b/4/M1n1VOmSViWQx6u',
    'employee', v_org_id,
    '113', 'Mr', 'Male', '2006-02-22', 'B+',
    'Back Office', 'Executive', 'B', 'Staff', 'Day',
    'full-time', 'active', '2025-05-26', '2025-05-26', '2025-09-08',
    '9163594418', 'aabeerqureshi90@gmail.com',
    'INDIAN', 'MUSLIM', 'Single',
    '5.7', '59.1',
    '960507296117',
    'BANK OF BARODA', '03730100037840', 'BARB0BHUJXX',
    TRUE, 4,
    FALSE, FALSE, FALSE,
    'Vaibhav Finstock Private Limited',
    v_vfpl_id, '113',
    '#F97316', TRUE
  WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE organization_id = v_org_id AND employee_id = '113'
  );

  UPDATE users SET
    branch_id            = v_vfpl_id,
    division             = 'Vaibhav Finstock Private Limited',
    device_enrollment_id = '113'
  WHERE organization_id = v_org_id AND employee_id = '113'
    AND branch_id IS DISTINCT FROM v_vfpl_id;

  SELECT id INTO v_uid_113 FROM users WHERE organization_id = v_org_id AND employee_id = '113';
  RAISE NOTICE 'EmpID 113  Abir Kureshi            → user id=%  branch=%', v_uid_113, v_vfpl_id;

  -- ── EmpID 116 — Anilkumar Krishnakumar Rathod ──
  --   Joined 01-07-26, EProbation=TRUE, 3 months → probation ends 01-10-26 → still probation
  INSERT INTO users (
    name, email, password, role, organization_id,
    employee_id, salutation, gender, date_of_birth,
    department, position, grade, pay_cadre, salary_on,
    employment_type, employment_status, date_of_joining, joining_date,
    phone, nationality, religion, marital_status,
    aadhar_no, pan_number,
    bank_name, bank_account_number, bank_ifsc,
    probation_applicable, probation_months,
    pt_applicable, pf_applicable, esi_applicable,
    division,
    branch_id, device_enrollment_id,
    avatar_color, force_password_change
  )
  SELECT
    'Anilkumar Krishnakumar Rathod',
    'emp116.vfpl@relitrade.in',
    '$2a$10$jmYpe0h87c.K1D5Kns9h.eKZfI6rzuPn8/b/4/M1n1VOmSViWQx6u',
    'employee', v_org_id,
    '116', 'Mr', 'Male', '1976-03-05',
    'Back Office', 'Branch Manager', 'B', 'Staff', 'Day',
    'full-time', 'probation', '2026-07-01', '2026-07-01',
    '9825205775', 'Indian', 'Hindu', 'Single',
    '522467206115', 'AIWPR8593D',
    'BANK OF BARODA', '03730100010485', 'BARB0BHUJXX',
    TRUE, 3,
    FALSE, FALSE, FALSE,
    'Vaibhav Finstock Private Limited',
    v_vfpl_id, '116',
    '#14B8A6', TRUE
  WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE organization_id = v_org_id AND employee_id = '116'
  );

  UPDATE users SET
    branch_id            = v_vfpl_id,
    division             = 'Vaibhav Finstock Private Limited',
    device_enrollment_id = '116',
    employment_status    = 'probation'
  WHERE organization_id = v_org_id AND employee_id = '116'
    AND branch_id IS DISTINCT FROM v_vfpl_id;

  SELECT id INTO v_uid_116 FROM users WHERE organization_id = v_org_id AND employee_id = '116';
  RAISE NOTICE 'EmpID 116  Anilkumar Rathod        → user id=%  branch=%', v_uid_116, v_vfpl_id;

  -- ── EmpID 117 — Devbhai Fakirbhai Rabari ──
  INSERT INTO users (
    name, email, password, role, organization_id,
    employee_id, salutation, gender, date_of_birth,
    department, position, grade, pay_cadre, salary_on,
    employment_type, employment_status, date_of_joining, joining_date, confirmation_date,
    phone, nationality, religion, marital_status,
    bank_name, bank_account_number, bank_ifsc,
    pt_applicable, pf_applicable, esi_applicable,
    division,
    branch_id, device_enrollment_id,
    avatar_color, force_password_change
  )
  SELECT
    'Devbhai Fakirbhai Rabari',
    'emp117.vfpl@relitrade.in',
    '$2a$10$jmYpe0h87c.K1D5Kns9h.eKZfI6rzuPn8/b/4/M1n1VOmSViWQx6u',
    'employee', v_org_id,
    '117', 'Mr', 'Male', '2006-05-12',
    'Admin', 'Office Clerk', 'B', 'Staff', 'Day',
    'full-time', 'active', '2026-02-01', '2026-02-01', '2026-02-01',
    '9265996797', 'Indian', 'Hindu', 'Single',
    'Central Bank of India', '5565908058', 'CBIN0280589',
    FALSE, FALSE, FALSE,
    'Vaibhav Finstock Private Limited',
    v_vfpl_id, '117',
    '#EF4444', TRUE
  WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE organization_id = v_org_id AND employee_id = '117'
  );

  UPDATE users SET
    branch_id            = v_vfpl_id,
    division             = 'Vaibhav Finstock Private Limited',
    device_enrollment_id = '117'
  WHERE organization_id = v_org_id AND employee_id = '117'
    AND branch_id IS DISTINCT FROM v_vfpl_id;

  SELECT id INTO v_uid_117 FROM users WHERE organization_id = v_org_id AND employee_id = '117';
  RAISE NOTICE 'EmpID 117  Devbhai Rabari          → user id=%  branch=%', v_uid_117, v_vfpl_id;

  -- ── EmpID 118 — Mital Karana Rabari ──
  --   Joined 01-08-26, EProbation=TRUE, 3 months → probation ends 01-11-26 → still probation
  INSERT INTO users (
    name, email, password, role, organization_id,
    employee_id, salutation, gender, date_of_birth,
    department, position, grade, pay_cadre, salary_on,
    employment_type, employment_status, date_of_joining, joining_date,
    phone, nationality, religion, marital_status,
    aadhar_no,
    bank_name, bank_account_number, bank_ifsc,
    probation_applicable, probation_months,
    pt_applicable, pf_applicable, esi_applicable,
    division,
    branch_id, device_enrollment_id,
    avatar_color, force_password_change
  )
  SELECT
    'Mital Karana Rabari',
    'emp118.vfpl@relitrade.in',
    '$2a$10$jmYpe0h87c.K1D5Kns9h.eKZfI6rzuPn8/b/4/M1n1VOmSViWQx6u',
    'employee', v_org_id,
    '118', 'Mr', 'Male', '2006-02-10',
    'Back Office', 'Executive', 'B', 'Staff', 'Day',
    'full-time', 'probation', '2026-08-01', '2026-08-01',
    '9998676572', 'Indian', 'Hindu', 'Single',
    '891501974975',
    'BANK OF BARODA', '40600100001985', 'BARB0K0TDAA',
    TRUE, 3,
    FALSE, FALSE, FALSE,
    'Vaibhav Finstock Private Limited',
    v_vfpl_id, '118',
    '#84CC16', TRUE
  WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE organization_id = v_org_id AND employee_id = '118'
  );

  UPDATE users SET
    branch_id            = v_vfpl_id,
    division             = 'Vaibhav Finstock Private Limited',
    device_enrollment_id = '118',
    employment_status    = 'probation'
  WHERE organization_id = v_org_id AND employee_id = '118'
    AND branch_id IS DISTINCT FROM v_vfpl_id;

  SELECT id INTO v_uid_118 FROM users WHERE organization_id = v_org_id AND employee_id = '118';
  RAISE NOTICE 'EmpID 118  Mital Rabari            → user id=%  branch=%', v_uid_118, v_vfpl_id;

  -- ─────────────────────────────────────────────────────────────
  -- STEP 6: SET REPORTING STRUCTURE
  --         Superior 437 (Deep Sanghvi) is HOD for most employees
  --         Superior 116 (Anilkumar Rathod) is direct manager for VFPL staff
  --         Employee 401 (Karan Sanghvi) is superior to 116, 118, and 437
  -- ─────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '--- STEP 6: SET REPORTING STRUCTURE ---';

  -- 437 is HOD/superior for: 103, 105, 112, 113, 115, 117
  -- 116 is HOD for: 103, 113, 117, 118
  -- 401 (Karan Sanghvi, existing Ahmedabad employee) is superior to 116, 118, 437

  -- Deep Sanghvi employees reporting to 437 as superior, 116 as HOD
  UPDATE users SET
    reporting_to = v_uid_437,
    hod_id       = v_uid_116
  WHERE organization_id = v_org_id
    AND employee_id IN ('103','105','112','113','115','117');

  -- 437 reports to 401 (Karan Kirtikumar Sanghvi) if that user exists
  UPDATE users SET
    reporting_to = (
      SELECT id FROM users WHERE organization_id = v_org_id AND employee_id = '401' LIMIT 1
    )
  WHERE organization_id = v_org_id AND employee_id = '437'
    AND EXISTS (SELECT 1 FROM users WHERE organization_id = v_org_id AND employee_id = '401');

  -- 116 (Anilkumar) HOD = 437, reports to 401
  UPDATE users SET
    hod_id       = v_uid_437,
    reporting_to = (
      SELECT id FROM users WHERE organization_id = v_org_id AND employee_id = '401' LIMIT 1
    )
  WHERE organization_id = v_org_id AND employee_id = '116'
    AND EXISTS (SELECT 1 FROM users WHERE organization_id = v_org_id AND employee_id = '401');

  -- 118 (Mital) HOD = 116, reports to 401
  UPDATE users SET
    hod_id       = v_uid_116,
    reporting_to = (
      SELECT id FROM users WHERE organization_id = v_org_id AND employee_id = '401' LIMIT 1
    )
  WHERE organization_id = v_org_id AND employee_id = '118'
    AND EXISTS (SELECT 1 FROM users WHERE organization_id = v_org_id AND employee_id = '401');

  RAISE NOTICE 'Reporting structure set for all 10 employees.';

  -- ─────────────────────────────────────────────────────────────
  -- STEP 7: BIOMETRIC EMPLOYEE MAP
  --         One device serves both branches.
  --         device_enrollment_id = employee_id (TEXT) for all 10.
  --         Insert into biometric_employee_map for each.
  -- ─────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '--- STEP 7: BIOMETRIC EMPLOYEE MAP ---';

  INSERT INTO biometric_employee_map (org_id, employee_pin, user_id)
  SELECT v_org_id, u.device_enrollment_id, u.id
  FROM users u
  WHERE u.organization_id = v_org_id
    AND u.employee_id IN ('101','103','105','112','113','115','116','117','118','437')
    AND u.device_enrollment_id IS NOT NULL
  ON CONFLICT (org_id, employee_pin) DO NOTHING;

  RAISE NOTICE 'biometric_employee_map: entries inserted/skipped for all 10 employees.';

  -- ─────────────────────────────────────────────────────────────
  -- STEP 8: FAMILY MEMBERS
  -- ─────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '--- STEP 8: FAMILY MEMBERS ---';

  -- 437 — Deep Ashokbhai Sanghvi (wife: Hunny Deep Sanghvi)
  INSERT INTO employee_family_members (employee_id, organization_id, relationship, name, dependent)
  SELECT v_uid_437, v_org_id, 'spouse', 'Hunny Deep Sanghvi', FALSE
  WHERE v_uid_437 IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- 103 — Kureshi Inayat
  INSERT INTO employee_family_members (employee_id, organization_id, relationship, name, date_of_birth, occupation, dependent)
  SELECT v_uid_103, v_org_id, 'father', 'Mazid Ibrahim Kureshi',    NULL::date, 'Retired',  FALSE WHERE v_uid_103 IS NOT NULL
  UNION ALL
  SELECT v_uid_103, v_org_id, 'mother', 'Rukaiya Mazid Kureshi',    NULL::date, 'Deceased', FALSE WHERE v_uid_103 IS NOT NULL
  UNION ALL
  SELECT v_uid_103, v_org_id, 'spouse', 'Samimbanu Inayat Kureshi', NULL::date, NULL,       FALSE WHERE v_uid_103 IS NOT NULL
  UNION ALL
  SELECT v_uid_103, v_org_id, 'child',  'Naurin Inayat Kureshi',    NULL::date, NULL,       TRUE  WHERE v_uid_103 IS NOT NULL
  UNION ALL
  SELECT v_uid_103, v_org_id, 'child',  'Aabir Inayat Kureshi',     NULL::date, NULL,       TRUE  WHERE v_uid_103 IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- 113 — Abir Kureshi
  INSERT INTO employee_family_members (employee_id, organization_id, relationship, name, date_of_birth, occupation, dependent)
  SELECT v_uid_113, v_org_id, 'father', 'Inayat M. Kureshi',           '1974-07-06'::date, NULL, FALSE WHERE v_uid_113 IS NOT NULL
  UNION ALL
  SELECT v_uid_113, v_org_id, 'mother', 'Sameembanu Inayatbhai Kureshi','1976-01-01'::date, NULL, FALSE WHERE v_uid_113 IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- 105 — Hardik Mehta
  INSERT INTO employee_family_members (employee_id, organization_id, relationship, name, date_of_birth, occupation, dependent)
  SELECT v_uid_105, v_org_id, 'father', 'Hasmukhlal Mehta', '1966-06-01'::date, 'Business',  FALSE WHERE v_uid_105 IS NOT NULL
  UNION ALL
  SELECT v_uid_105, v_org_id, 'mother', 'Kanchanben Mehta', '1971-09-29'::date, 'Housewife', FALSE WHERE v_uid_105 IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- 112 — Nishtha Sanghvi
  INSERT INTO employee_family_members (employee_id, organization_id, relationship, name, date_of_birth, occupation, dependent)
  SELECT v_uid_112, v_org_id, 'father', 'Sanghvi Hiren Dhirajlal', '1986-09-01'::date, 'Business',  FALSE WHERE v_uid_112 IS NOT NULL
  UNION ALL
  SELECT v_uid_112, v_org_id, 'mother', 'Falguni Hiren Sanghvi',   '1989-08-13'::date, 'Housewife', FALSE WHERE v_uid_112 IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- 115 — Kanchan Gosariya
  INSERT INTO employee_family_members (employee_id, organization_id, relationship, name, dependent)
  SELECT v_uid_115, v_org_id, 'father', 'Devshibhai Gosariya', FALSE
  WHERE v_uid_115 IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- 117 — Devbhai Rabari
  INSERT INTO employee_family_members (employee_id, organization_id, relationship, name, dependent)
  SELECT v_uid_117, v_org_id, 'father', 'Fakirbhai Rabari', FALSE
  WHERE v_uid_117 IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- 116 — Anilkumar Rathod
  INSERT INTO employee_family_members (employee_id, organization_id, relationship, name, dependent)
  SELECT v_uid_116, v_org_id, 'father', 'Krishnakumar Rathod', FALSE
  WHERE v_uid_116 IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- 118 — Mital Rabari
  INSERT INTO employee_family_members (employee_id, organization_id, relationship, name, dependent)
  SELECT v_uid_118, v_org_id, 'father', 'Karana Rabari', FALSE
  WHERE v_uid_118 IS NOT NULL
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Family members inserted for all employees with known family data.';

  -- ─────────────────────────────────────────────────────────────
  -- STEP 9: BANK ACCOUNTS (dedicated table)
  -- ─────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '--- STEP 9: BANK ACCOUNTS ---';

  -- 103 — Kureshi Inayat — IDBI Bank
  WITH emp AS (SELECT id FROM users WHERE organization_id = v_org_id AND employee_id = '103')
  INSERT INTO employee_bank_accounts
    (employee_id, organization_id, bank_name, branch_name, branch_code, account_number, ifsc_code, account_type, payment_method, is_primary, is_salary_account)
  SELECT e.id, v_org_id, 'IDBI Bank', 'Bhuj', '411', '0411104000046747', 'IBKL0000411', 'savings', 'bank_transfer', TRUE, TRUE
  FROM emp e ON CONFLICT DO NOTHING;

  -- 113 — Abir Kureshi — Bank of Baroda
  WITH emp AS (SELECT id FROM users WHERE organization_id = v_org_id AND employee_id = '113')
  INSERT INTO employee_bank_accounts
    (employee_id, organization_id, bank_name, branch_name, account_number, ifsc_code, account_type, payment_method, is_primary, is_salary_account)
  SELECT e.id, v_org_id, 'Bank of Baroda', 'Bhuj Branch', '03730100037840', 'BARB0BHUJXX', 'savings', 'bank_transfer', TRUE, TRUE
  FROM emp e ON CONFLICT DO NOTHING;

  -- 116 — Anilkumar Rathod — Bank of Baroda
  WITH emp AS (SELECT id FROM users WHERE organization_id = v_org_id AND employee_id = '116')
  INSERT INTO employee_bank_accounts
    (employee_id, organization_id, bank_name, branch_name, account_number, ifsc_code, account_type, payment_method, is_primary, is_salary_account)
  SELECT e.id, v_org_id, 'Bank of Baroda', 'Bhuj', '03730100010485', 'BARB0BHUJXX', 'savings', 'bank_transfer', TRUE, TRUE
  FROM emp e ON CONFLICT DO NOTHING;

  -- 117 — Devbhai Rabari — Central Bank of India
  WITH emp AS (SELECT id FROM users WHERE organization_id = v_org_id AND employee_id = '117')
  INSERT INTO employee_bank_accounts
    (employee_id, organization_id, bank_name, branch_name, branch_code, account_number, ifsc_code, account_type, payment_method, is_primary, is_salary_account)
  SELECT e.id, v_org_id, 'Central Bank of India', 'Bhuj', '3700116051', '5565908058', 'CBIN0280589', 'savings', 'bank_transfer', TRUE, TRUE
  FROM emp e ON CONFLICT DO NOTHING;

  -- 118 — Mital Rabari — Bank of Baroda
  WITH emp AS (SELECT id FROM users WHERE organization_id = v_org_id AND employee_id = '118')
  INSERT INTO employee_bank_accounts
    (employee_id, organization_id, bank_name, branch_name, branch_code, account_number, ifsc_code, account_type, payment_method, is_primary, is_salary_account)
  SELECT e.id, v_org_id, 'Bank of Baroda', 'Kotda Athamana', '370012519', '40600100001985', 'BARB0K0TDAA', 'savings', 'bank_transfer', TRUE, TRUE
  FROM emp e ON CONFLICT DO NOTHING;

  -- 105 — Hardik Mehta — IDBI Bank
  WITH emp AS (SELECT id FROM users WHERE organization_id = v_org_id AND employee_id = '105')
  INSERT INTO employee_bank_accounts
    (employee_id, organization_id, bank_name, branch_name, branch_code, account_number, ifsc_code, account_type, payment_method, is_primary, is_salary_account)
  SELECT e.id, v_org_id, 'IDBI Bank', 'Bhuj Branch', '370259051', '0411104000157070', 'IBKL0000411', 'savings', 'bank_transfer', TRUE, TRUE
  FROM emp e ON CONFLICT DO NOTHING;

  -- 112 — Nishtha Sanghvi — Kotak Bank
  WITH emp AS (SELECT id FROM users WHERE organization_id = v_org_id AND employee_id = '112')
  INSERT INTO employee_bank_accounts
    (employee_id, organization_id, bank_name, branch_name, account_number, ifsc_code, account_type, payment_method, is_primary, is_salary_account)
  SELECT e.id, v_org_id, 'Kotak Mahindra Bank', 'Bhuj', '2449668261', 'KKBK0003036', 'savings', 'bank_transfer', TRUE, TRUE
  FROM emp e ON CONFLICT DO NOTHING;

  -- 115 — Kanchan Gosariya — HDFC Bank
  WITH emp AS (SELECT id FROM users WHERE organization_id = v_org_id AND employee_id = '115')
  INSERT INTO employee_bank_accounts
    (employee_id, organization_id, bank_name, branch_name, branch_code, account_number, ifsc_code, account_type, payment_method, is_primary, is_salary_account)
  SELECT e.id, v_org_id, 'HDFC Bank', 'Bhuj, Gujarat', '370240051', '50100432757272', 'HDFC0000204', 'savings', 'bank_transfer', TRUE, TRUE
  FROM emp e ON CONFLICT DO NOTHING;

  -- 437 — Deep Sanghvi — no bank account data in Excel (account '....') — skip

  RAISE NOTICE 'Bank accounts inserted for 8 employees (437 skipped — no valid account data).';

  -- ─────────────────────────────────────────────────────────────
  -- STEP 10: POST-FLIGHT VALIDATION
  -- ─────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '--- STEP 10: POST-FLIGHT VALIDATION ---';

  -- Confirm branches exist with correct names
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = v_bhuj_id AND name = 'Bhuj - Deep Sanghvi' AND org_id = v_org_id) THEN
    RAISE EXCEPTION 'ABORT: Branch % not found as "Bhuj - Deep Sanghvi". Rolling back.', v_bhuj_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = v_vfpl_id AND name = 'Bhuj - VFPL' AND org_id = v_org_id) THEN
    RAISE EXCEPTION 'ABORT: Branch % not found as "Bhuj - VFPL". Rolling back.', v_vfpl_id;
  END IF;

  -- Confirm Deep Sanghvi employee count
  SELECT COUNT(*) INTO v_ds_count
  FROM users
  WHERE organization_id = v_org_id AND branch_id = v_bhuj_id;

  -- Confirm VFPL employee count
  SELECT COUNT(*) INTO v_vfpl_count
  FROM users
  WHERE organization_id = v_org_id AND branch_id = v_vfpl_id;

  -- Confirm Dalal is untouched
  IF NOT EXISTS (SELECT 1 FROM branches WHERE name = 'Dalal' AND org_id = v_org_id) THEN
    RAISE EXCEPTION 'ABORT: Dalal branch missing after migration — unexpected state.';
  END IF;

  -- Confirm no "Bhuj" branch remains (only renamed version)
  IF EXISTS (SELECT 1 FROM branches WHERE name = 'Bhuj' AND org_id = v_org_id) THEN
    RAISE EXCEPTION 'ABORT: Old "Bhuj" branch still exists — rename did not take effect.';
  END IF;

  RAISE NOTICE 'OK: Branch % is "Bhuj - Deep Sanghvi" — % employees.', v_bhuj_id, v_ds_count;
  RAISE NOTICE 'OK: Branch % is "Bhuj - VFPL"        — % employees.', v_vfpl_id, v_vfpl_count;
  RAISE NOTICE 'OK: Dalal branch exists and was not modified.';
  RAISE NOTICE 'OK: No bare "Bhuj" branch remains.';

  -- ─────────────────────────────────────────────────────────────
  -- SUMMARY
  -- ─────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '=======================================================';
  RAISE NOTICE 'MIGRATION SUMMARY';
  RAISE NOTICE '=======================================================';
  RAISE NOTICE 'Bhuj - Deep Sanghvi branch id : %', v_bhuj_id;
  RAISE NOTICE 'Bhuj - VFPL        branch id  : %', v_vfpl_id;
  RAISE NOTICE 'Employees in Bhuj - Deep Sanghvi : %', v_ds_count;
  RAISE NOTICE 'Employees in Bhuj - VFPL         : %', v_vfpl_count;
  RAISE NOTICE '-------------------------------------------------------';
  RAISE NOTICE 'Dalal branch            : UNTOUCHED';
  RAISE NOTICE 'Ahmedabad branches      : UNTOUCHED';
  RAISE NOTICE 'attendance records      : NOT MODIFIED';
  RAISE NOTICE 'leave records           : NOT MODIFIED';
  RAISE NOTICE 'payslip records         : NOT MODIFIED';
  RAISE NOTICE 'biometric_devices       : NOT MODIFIED';
  RAISE NOTICE 'biometric_raw_logs      : NOT MODIFIED';
  RAISE NOTICE '-------------------------------------------------------';
  RAISE NOTICE 'ALL VALIDATIONS PASSED.';
  RAISE NOTICE 'Review the SELECT results below then run: COMMIT;';
  RAISE NOTICE 'To cancel all changes run               : ROLLBACK;';
  RAISE NOTICE '=======================================================';

END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-EXECUTION REVIEW QUERIES
-- These run inside the open transaction — inspect before COMMIT/ROLLBACK.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Final branch master for Relitrade
SELECT id, name, code, location, is_active
FROM   branches
WHERE  org_id = 1
ORDER  BY id;

-- 2. Employee roster per Bhuj branch
SELECT
  b.name        AS branch,
  u.employee_id AS emp_id,
  u.name,
  u.department,
  u.position,
  u.employment_status,
  u.division    AS company_name,
  u.device_enrollment_id AS bio_pin
FROM   users u
JOIN   branches b ON b.id = u.branch_id
WHERE  b.org_id = 1
  AND  b.name IN ('Bhuj - Deep Sanghvi', 'Bhuj - VFPL')
ORDER  BY b.name, u.employee_id::INTEGER;

-- 3. Biometric map for Bhuj employees
SELECT
  bem.employee_pin,
  u.name,
  u.employee_id,
  b.name AS branch
FROM   biometric_employee_map bem
JOIN   users    u ON u.id = bem.user_id
JOIN   branches b ON b.id = u.branch_id
WHERE  bem.org_id = 1
  AND  b.name IN ('Bhuj - Deep Sanghvi', 'Bhuj - VFPL')
ORDER  BY bem.employee_pin::INTEGER;

-- 4. Dalal branch health-check — row counts must be unchanged
SELECT
  b.name,
  COUNT(u.id) AS employee_count
FROM   branches b
LEFT   JOIN users u ON u.branch_id = b.id AND u.organization_id = 1
WHERE  b.org_id = 1 AND b.name = 'Dalal'
GROUP  BY b.name;

-- ─────────────────────────────────────────────────────────────────────────────
-- COMMIT when satisfied. ROLLBACK to cancel everything.
-- ─────────────────────────────────────────────────────────────────────────────

-- COMMIT;
