const express = require('express');
const router  = express.Router();
const bcrypt   = require('bcryptjs');
const { db, pool } = require('../../config/db');
const { V, validateBody } = require('../../utils/fieldValidators');
const { auth, isAdminRole, blockUser, unblockUser, markRoleChanged, revokeSessionsQuiet } = require('../../middleware/auth');
const { clearUserCache } = require('../../services/permissionService');
const { hasPermission } = require('../../middleware/permissions');
const { orgId, getOrgContext } = require('../../utils/helpers');
const { withBranchContext } = require('../../middleware/branchContext');
const { getFilterState, canAdminAccessUser } = require('../../utils/branchFilter');
const { validateBranchIdList, clearBranchAccessCache, isBranchFeatureEnabled } = require('../../services/branchService');

// Every referenced department must belong to the caller's organisation.
async function validateDepartmentIds(ids, oId) {
  const nums = [...new Set((ids || []).map(n => parseInt(n, 10)))];
  if (nums.some(n => !Number.isInteger(n) || n <= 0)) return { ok: false, error: 'Invalid department id' };
  if (!nums.length) return { ok: true };
  const { rows } = await pool.query(
    'SELECT id FROM departments WHERE organization_id = $1 AND id = ANY($2::bigint[])', [oId, nums]);
  return rows.length === nums.length ? { ok: true } : { ok: false, error: 'One or more departments do not belong to your organisation' };
}
const { sendMail, welcomeEmployeeHtml, preOnboardingRequestHtml, credentialsEmailHtml } = require('../../services/emailService');
const crypto = require('crypto');
const { initOnboarding } = require('../onboarding/onboardingService');
const lifecycle = require('../../services/employeeLifecycle');
const upload     = require('../../middleware/upload');
const cloudinary = require('../../config/cloudinary');

// ─── NEW COLUMNS (biometric / Sanghavi) added to the standard employee fields ──
const EMPLOYEE_PUBLIC_COLS = [
  'id', 'name', 'email', 'role', 'department', 'position', 'avatar_color', 'employee_id',
  'date_of_birth', 'created_at', 'phone', 'personal_email', 'joining_date',
  'employment_type', 'work_mode', 'employee_status', 'ctc', 'salary_effective_date',
  // new HRMS columns
  'device_enrollment_id', 'branch_id', 'grade', 'division', 'sub_division',
  'salutation', 'middle_name', 'surname', 'location', 'pay_cadre',
  'weekly_off_day', 'work_hours_per_day',
  // payroll / internal settings (needed for SystemTab display)
  'salary_on', 'salary_structure',
  // personal profile fields
  'gender', 'blood_group', 'marital_status', 'nationality', 'religion',
  'citizenship', 'height', 'weight',
  // probation management
  'probation_applicable', 'probation_months', 'probation_start_date', 'probation_end_date',
].join(', ');

// Sensitive statutory fields — admin only (last_credentials_sent_at added via startup migration)
const EMPLOYEE_ADMIN_COLS = EMPLOYEE_PUBLIC_COLS + ', aadhar_no, pan_number, uan_no, pf_applicable, pf_no, esi_applicable, esi_no, ot_applicable, ot_rate, force_password_change, last_credentials_sent_at';

// ─── Employees: List ──────────────────────────────────────────────────────────
// BUG_059 / BUG_068: By default exclude inactive/resigned/terminated employees so
// they do not appear in Calendar, TeamCalendar, Reports, or any other consumer of
// this endpoint.  Pass ?include_inactive=true to retrieve all statuses (used by
// the Employees management page itself so HR can explicitly filter for them).
const INACTIVE_STATUSES = ['inactive', 'resigned', 'terminated'];

// Directory-only columns for non-admin callers (dept heads / custom roles holding
// employees.view). No salary, statutory or personal-contact data — an extra permission
// must never expose admin-only information.
const EMPLOYEE_DIRECTORY_COLS = [
  'id', 'name', 'email', 'role', 'department', 'position', 'avatar_color', 'employee_id',
  'joining_date', 'employment_type', 'work_mode', 'employee_status', 'branch_id',
].join(', ');
// Lightweight payload for dropdowns / pickers (?lite=1).
const EMPLOYEE_LITE_COLS = [
  'id', 'name', 'email', 'role', 'department', 'position', 'avatar_color', 'employee_id',
  'employee_status', 'branch_id', 'device_enrollment_id',
].join(', ');

router.get('/', auth, hasPermission('employees', 'view'), withBranchContext, async (req, res) => {
  try {
    // root_admin sees all non-root users (HR admins + employees); others see only employees
    const roleFilter = req.user.role === 'root_admin' ? ['admin', 'employee'] : ['employee'];
    const isAdminCaller = isAdminRole(req.user.role);
    let cols = isAdminCaller ? EMPLOYEE_ADMIN_COLS : EMPLOYEE_DIRECTORY_COLS;
    if (req.query.lite === '1' || req.query.lite === 'true') {
      cols = isAdminCaller ? EMPLOYEE_LITE_COLS : EMPLOYEE_DIRECTORY_COLS;
    }

    // ── Branch filter: applies to EVERY caller. Non-admins (dept head / custom role) are
    // bound to their own branch by getUserBranchAccess — extra permissions never widen it.
    const branchState = getFilterState(req.branchContext);

    // State D: no accessible branches → empty list
    if (branchState.type === 'none') return res.json([]);

    // Build parameterised WHERE clauses for the single-query path
    const params = [orgId(req), roleFilter];

    let branchClause = '';
    if (branchState.type === 'specific') {
      params.push(branchState.branchId);
      branchClause = `AND u.branch_id = $${params.length}`;
    } else if (branchState.type === 'multi') {
      params.push(branchState.branchIds);
      branchClause = `AND u.branch_id = ANY($${params.length}::bigint[])`;
    }

    // BUG_059: exclude inactive/resigned/terminated unless caller opts in
    const inactiveClause = req.query.include_inactive !== 'true'
      ? `AND (u.employee_status IS NULL OR u.employee_status NOT IN ('inactive','resigned','terminated'))`
      : '';

    // Prefix every column with the table alias to avoid ambiguity in the JOIN
    const colsList = cols.split(', ').map(c => `u."${c.trim()}"`).join(', ');

    // Single query: employees + departments aggregated — eliminates the second round-trip
    const { rows } = await pool.query(`
      SELECT ${colsList},
        COALESCE(
          json_agg(
            json_build_object('id', d.id, 'name', d.name, 'role', ud.role_in_dept)
          ) FILTER (WHERE d.id IS NOT NULL),
          '[]'::json
        ) AS departments
      FROM users u
      LEFT JOIN user_departments ud ON ud.user_id = u.id
      LEFT JOIN departments d ON d.id = ud.department_id
      WHERE u.organization_id = $1
        AND u.role = ANY($2::text[])
        ${branchClause}
        ${inactiveClause}
      GROUP BY u.id
      ORDER BY u.name
    `, params);

    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Employees: Create ────────────────────────────────────────────────────────
// Shared by create + edit (EMP-xxx: name / position / phone / email / DOB / probation validation).
const EMPLOYEE_FIELD_RULES = {
  name: V.text('Full name'), position: V.text('Position / title'), phone: V.phone('Mobile number'),
  personal_email: V.email('Personal email'), date_of_birth: V.pastDate('Date of birth'),
  probation_months: V.nonNegativeInt('Probation months'),
};

router.post('/', auth, hasPermission('employees', 'create'), validateBody(EMPLOYEE_FIELD_RULES), withBranchContext, async (req, res) => {
  try {
    const { name, email, role, department, position, avatar_color, date_of_birth } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
    // Only a root admin may create admin-level accounts (Manage HR Admins / Root Admins).
    if (req.user.role !== 'root_admin' && role && role !== 'employee') {
      return res.status(403).json({ error: 'Only root admins can create HR admin or root admin accounts' });
    }
    // BUG_154: validate email format before uniqueness check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return res.status(400).json({ error: 'Please enter a valid Company Email address (e.g. name@company.com).' });
    if (role === 'root_admin' && req.user.role !== 'root_admin') {
      return res.status(403).json({ error: 'Only root admins can create root_admin accounts' });
    }

    // Global email uniqueness — no two users across any org may share an email
    const { data: dupEmail } = await db.from('users').select('id').eq('email', email.toLowerCase().trim()).maybeSingle();
    if (dupEmail) return res.status(400).json({ error: 'This email is already registered on the platform. Each user must have a unique email address.' });

    // BUG_051: duplicate employee name within same org
    const { data: dupName } = await db.from('users')
      .select('id').eq('organization_id', orgId(req)).ilike('name', name.trim()).maybeSingle();
    if (dupName) return res.status(400).json({ error: 'An employee with this name already exists in your organisation.' });

    // Generate a secure random temporary password server-side.
    // Never accept a password from the client for new employee creation.
    const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
    const tempPassword = Array.from(crypto.randomBytes(12), b => CHARS[b % CHARS.length]).join('');
    const hashed = bcrypt.hashSync(tempPassword, 10);

    const {
      device_enrollment_id, branch_id, grade, division, sub_division,
      salutation, middle_name, surname, location, pay_cadre,
      weekly_off_day, work_hours_per_day, designation_id, employment_type,
      joining_date, phone, probation_applicable, probation_months,
    } = req.body;

    // Auto-assign the only active branch when none is supplied.
    // If the org has 2+ branches the caller must specify one explicitly.
    // Branch rules (only when the org actually has branches — otherwise behaviour is unchanged):
    //   * the branch must belong to the org AND be inside the caller's access
    //   * none supplied → the single active branch, else the caller's selected branch,
    //     else (HR with exactly one accessible branch) that branch; otherwise a branch is required
    //   * a multi-branch org never gets a silently NULL-branch employee
    let resolvedBranchId = null;
    let activeBranchIds = [];
    try {
      const sb = await pool.query(
        `SELECT id FROM branches WHERE org_id = $1 AND is_active = TRUE`, [orgId(req)]);
      activeBranchIds = sb.rows.map(r => Number(r.id));
    } catch (_) {}
    if (branch_id) {
      const v = await validateBranchIdList(req.user.id, orgId(req), req.user.role, [branch_id]);
      if (!v.ok) return res.status(403).json({ error: v.error });
      resolvedBranchId = v.ids[0];
    } else if (activeBranchIds.length === 1) {
      resolvedBranchId = activeBranchIds[0];
    } else if (activeBranchIds.length > 1 && (role || 'employee') === 'employee' && await isBranchFeatureEnabled(orgId(req))) {
      const sel = req.branchContext?.selectedBranchId;
      const acc = req.branchContext?.accessibleBranchIds;
      if (sel) resolvedBranchId = Number(sel);
      else if (Array.isArray(acc) && acc.length === 1) resolvedBranchId = Number(acc[0]);
      else return res.status(400).json({ error: 'Branch is required for this organisation.' });
      const v = await validateBranchIdList(req.user.id, orgId(req), req.user.role, [resolvedBranchId]);
      if (!v.ok) return res.status(403).json({ error: v.error });
    }

    // user INSERT + department assignments must be atomic.
    // A user with no department assignments is a valid partial state we must prevent.
    const department_ids = req.body.department_ids;
    if (Array.isArray(department_ids) && department_ids.length > 0) {
      const dv = await validateDepartmentIds(department_ids, orgId(req));
      if (!dv.ok) return res.status(400).json({ error: dv.error });
    }
    if (designation_id) {
      const { rows: dg } = await pool.query(
        'SELECT 1 FROM designations WHERE id = $1 AND organization_id = $2', [parseInt(designation_id), orgId(req)]);
      if (!dg.length) return res.status(400).json({ error: 'Designation not found in your organisation' });
    }

    // Resolve the display department name from department_ids[0] so users.department
    // stays in sync with user_departments — same logic as the EDIT handler (M-12).
    let resolvedDeptName = department || 'General';
    if (Array.isArray(department_ids) && department_ids.length > 0) {
      try {
        const dRes = await pool.query(
          'SELECT name FROM departments WHERE id = $1 AND organization_id = $2',
          [parseInt(department_ids[0]), orgId(req)]
        );
        if (dRes.rows[0]?.name) resolvedDeptName = dRes.rows[0].name;
      } catch (_) {}
    }

    const client = await pool.connect();
    let newUser;
    try {
      await client.query('BEGIN');

      const userRes = await client.query(
        `INSERT INTO users
           (name, email, password, role, department, position, avatar_color,
            date_of_birth, force_password_change, organization_id,
            device_enrollment_id, branch_id, grade, division, sub_division,
            salutation, middle_name, surname, location, pay_cadre,
            weekly_off_day, work_hours_per_day, designation_id, employment_type,
            joining_date, phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
         RETURNING id, name, email, role, department, position, avatar_color, date_of_birth`,
        [name, email.toLowerCase(), hashed, role||'employee', resolvedDeptName,
         position||'Staff', avatar_color||'#4F46E5', date_of_birth||null, orgId(req),
         device_enrollment_id||null, resolvedBranchId||null, grade||null, division||null,
         sub_division||null, salutation||null, middle_name||null, surname||null,
         location||null, pay_cadre||null, weekly_off_day||null, work_hours_per_day||null,
         designation_id ? parseInt(designation_id) : null,
         employment_type || 'full_time',
         joining_date || null, phone || null]
      );
      newUser = userRes.rows[0];

      if (Array.isArray(department_ids) && department_ids.length > 0) {
        // junction + users.department + users.department_id (legacy FK) in one place
        await lifecycle.syncUserDepartments({ client, orgId: orgId(req), userId: newUser.id, departmentIds: department_ids });
      }

      // Probation chosen on the Add form was previously dropped by the API (the form showed it, nothing stored it).
      if (probation_applicable === true || probation_applicable === 'true') {
        const pd = lifecycle.computeProbationDates(joining_date, probation_months);
        await client.query(
          `UPDATE users SET probation_applicable = TRUE, probation_months = $3, probation_start_date = $4,
                  probation_end_date = $5, employee_status = 'probation' WHERE id = $1 AND organization_id = $2`,
          [newUser.id, orgId(req), parseInt(probation_months, 10) || 0, pd?.start || null, pd?.end || null]);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') return res.status(400).json({ error: 'Email already exists' });
      throw err;
    } finally {
      client.release();
    }

    // Auto-grant hr_branch_access for new HR admins in single-branch orgs.
    // branchService will derive this implicitly anyway, but an explicit row
    // ensures the grant survives if a second branch is later added.
    if ((role === 'admin') && resolvedBranchId) {
      pool.query(
        `INSERT INTO hr_branch_access (user_id, org_id, branch_id, all_branches, granted_by)
         VALUES ($1, $2, $3, FALSE, $4) ON CONFLICT DO NOTHING`,
        [newUser.id, orgId(req), resolvedBranchId, req.user.id]
      ).catch(() => {});
    }

    // A PIN typed on the Add form must reach the biometric map just like it does on edit.
    if (device_enrollment_id) await lifecycle.syncBiometricPin({ orgId: orgId(req), userId: newUser.id, pin: device_enrollment_id });

    // Fire-and-forget side effects after COMMIT.
    // Send account credentials using the server-generated temp password.
    // The plaintext password is only ever in memory here — never logged, never returned in the API response.
    getOrgContext(orgId(req)).then(({ orgName, orgEmail }) => {
      const portalUrl = process.env.FRONTEND_URL || 'https://hrms.lumoslogic.com';
      sendMail({
        to:      email,
        subject: `Welcome to ${orgName || 'the Team'} — Your Login Details`,
        html:    credentialsEmailHtml({
          employee:    { name, email, department: resolvedDeptName, position: position || 'Staff' },
          tempPassword,
          orgName,
          orgEmail,
          portalUrl,
        }),
      }).catch(() => {}); // non-fatal — employee is already created
    });
    db.from('platform_activity').insert({ event_type: 'member_added', organization_id: orgId(req), description: `Member added: ${name} (${email})`, metadata: { name, email, role: role||'employee', org_id: orgId(req) } }).then(() => {});

    // Auto-initialize onboarding checklist (fire-and-forget)
    if ((role || 'employee') === 'employee') {
      initOnboarding(newUser.id, orgId(req)).catch(() => {});

      // Pre-onboarding document request email — ask the new employee to upload
      // their joining documents before the onboarding checklist begins.
      if (email) {
        const { data: org } = await db.from('organizations')
          .select('name').eq('id', orgId(req)).maybeSingle().catch(() => ({ data: null }));
        const portalUrl = `${process.env.FRONTEND_URL || 'https://hrms.lumoslogic.com'}/portal/documents`;
        sendMail({
          to: email,
          subject: `Action Required — Upload Your Joining Documents`,
          html: preOnboardingRequestHtml({ name, orgName: org?.name || 'Your Organisation', portalUrl }),
        });
      }
    }

    // Assign matching RBAC system role (fire-and-forget; harmless if RBAC tables not yet migrated)
    const rbacSlugMap = { employee: 'employee', admin: 'hr_admin', root_admin: 'root_admin' };
    const rbacSlug = rbacSlugMap[role || 'employee'];
    if (rbacSlug) {
      db.from('roles')
        .select('id')
        .eq('org_id', orgId(req))
        .eq('slug', rbacSlug)
        .maybeSingle()
        .then(({ data: sysRole }) => {
          if (sysRole?.id) {
            return db.from('user_roles').insert({
              user_id:     newUser.id,
              role_id:     sysRole.id,
              org_id:      orgId(req),
              assigned_by: req.user.id,
            });
          }
        })
        .catch(() => {});
    }
    const data = newUser;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Employees: Update ────────────────────────────────────────────────────────
router.put('/:id', auth, hasPermission('employees', 'edit'), validateBody(EMPLOYEE_FIELD_RULES), withBranchContext, async (req, res) => {
  try {
    // Branch isolation: admin must have access to the target employee's branch.
    if (isAdminRole(req.user.role) && req.user.role !== 'root_admin') {
      if (!await canAdminAccessUser(req.branchContext, parseInt(req.params.id), orgId(req)))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
    }

    // Target must exist in this org. Non-root callers may not modify admin-level accounts
    // (password reset / role change on an HR or root admin would be privilege escalation)
    // other than their own record.
    const targetId = parseInt(req.params.id, 10);
    const { rows: tgtRows } = await pool.query(
      'SELECT id, role, branch_id, employee_status, department FROM users WHERE id = $1 AND organization_id = $2', [targetId, orgId(req)]);
    if (!tgtRows.length) return res.status(404).json({ error: 'Employee not found in this organisation' });
    const tgt = tgtRows[0];
    if (req.user.role !== 'root_admin' && tgt.role !== 'employee' && targetId !== req.user.id) {
      return res.status(403).json({ error: 'Only root admins can modify HR admin or root admin accounts' });
    }
    if (req.user.role !== 'root_admin' && req.body.role !== undefined && req.body.role !== tgt.role) {
      return res.status(403).json({ error: 'Only root admins can change an account role' });
    }
    // Branch changes are explicit: only touched when branch_id is present in the body.
    const branchProvided = Object.prototype.hasOwnProperty.call(req.body, 'branch_id');
    let nextBranchId;
    if (branchProvided) {
      if (!req.body.branch_id) {
        const { rows: ab } = await pool.query(
          'SELECT 1 FROM branches WHERE org_id = $1 AND is_active = TRUE LIMIT 1', [orgId(req)]);
        if (ab.length && tgt.role === 'employee')
          return res.status(400).json({ error: 'An employee in a branch-enabled organisation must belong to a branch.' });
        nextBranchId = null;
      } else if (String(req.body.branch_id) !== String(tgt.branch_id)) {
        const v = await validateBranchIdList(req.user.id, orgId(req), req.user.role, [req.body.branch_id]);
        if (!v.ok) return res.status(403).json({ error: v.error });
        nextBranchId = v.ids[0];
      } else {
        nextBranchId = Number(tgt.branch_id);
      }
    }
    if (Array.isArray(req.body.department_ids) && req.body.department_ids.length > 0) {
      const dv = await validateDepartmentIds(req.body.department_ids, orgId(req));
      if (!dv.ok) return res.status(400).json({ error: dv.error });
    }
    if (req.body.designation_id) {
      const { rows: dg } = await pool.query(
        'SELECT 1 FROM designations WHERE id = $1 AND organization_id = $2', [parseInt(req.body.designation_id), orgId(req)]);
      if (!dg.length) return res.status(400).json({ error: 'Designation not found in your organisation' });
    }
    // A biometric PIN already mapped to someone outside the caller's branch scope cannot be
    // taken over through an employee edit (ingestion stays branch-neutral; this is management).
    if (req.body.device_enrollment_id) {
      const pin = String(req.body.device_enrollment_id).trim();
      const { rows: mapRows } = await pool.query(
        'SELECT user_id FROM biometric_employee_map WHERE org_id = $1 AND employee_pin = $2', [orgId(req), pin]);
      const owner = mapRows[0]?.user_id;
      if (owner && Number(owner) !== targetId && req.user.role !== 'root_admin') {
        if (!await canAdminAccessUser(req.branchContext, owner, orgId(req)))
          return res.status(403).json({ error: 'This biometric PIN is mapped to an employee outside your branch access.' });
      }
    }

    const {
      name, email, role, department, position, avatar_color, password, date_of_birth, department_ids,
      phone, personal_email, joining_date, employment_type, work_mode, employee_status, ctc, salary_effective_date,
      // new HRMS columns
      device_enrollment_id, branch_id, grade, division, sub_division,
      salutation, middle_name, surname, location, pay_cadre,
      weekly_off_day, work_hours_per_day, designation_id,
      // personal profile fields
      gender, blood_group, marital_status, nationality, religion,
      citizenship, height, weight,
      // probation management
      probation_applicable, probation_months,
    } = req.body;
    if (role === 'root_admin' && req.user.role !== 'root_admin') {
      return res.status(403).json({ error: 'Only root admins can assign the root_admin role' });
    }

    // If email is being changed, verify it's not already taken by another user anywhere on the platform
    if (email) {
      const { data: dupEmail } = await db.from('users')
        .select('id').eq('email', email.toLowerCase().trim()).neq('id', parseInt(req.params.id)).maybeSingle();
      if (dupEmail) return res.status(400).json({ error: 'This email is already registered on the platform. Each user must have a unique email address.' });
    }

    // PARTIAL-SAFE: only keys present in the body are written. (The previous `x || null` pattern turned every
    // absent field into NULL, so a partial call such as the bulk "Change Status" tried to null name/email/phone/
    // joining_date/ctc/…). Keys that ARE sent keep the old semantics: an empty value clears the column.
    const has = (k) => Object.prototype.hasOwnProperty.call(req.body, k);
    const nl = (k, v) => (has(k) ? (v || null) : undefined);
    const update = {
      name, email, role, department, position, avatar_color,
      date_of_birth:        nl('date_of_birth', date_of_birth),
      phone:                nl('phone', phone),
      personal_email:       nl('personal_email', personal_email),
      joining_date:         nl('joining_date', joining_date),
      employment_type:      nl('employment_type', employment_type),
      work_mode:            nl('work_mode', work_mode),
      employee_status:      nl('employee_status', employee_status),
      ctc:                  nl('ctc', ctc),
      salary_effective_date: nl('salary_effective_date', salary_effective_date),
      // new HRMS columns
      device_enrollment_id: nl('device_enrollment_id', device_enrollment_id),
      grade:                nl('grade', grade),
      division:             nl('division', division),
      sub_division:         nl('sub_division', sub_division),
      salutation:           nl('salutation', salutation),
      middle_name:          nl('middle_name', middle_name),
      surname:              nl('surname', surname),
      location:             nl('location', location),
      pay_cadre:            nl('pay_cadre', pay_cadre),
      weekly_off_day:       nl('weekly_off_day', weekly_off_day),
      work_hours_per_day:   nl('work_hours_per_day', work_hours_per_day),
      designation_id:       has('designation_id') ? (designation_id ? parseInt(designation_id) : null) : undefined,
      // personal profile fields
      gender:               nl('gender', gender),
      blood_group:          nl('blood_group', blood_group),
      marital_status:       nl('marital_status', marital_status),
      nationality:          nl('nationality', nationality),
      religion:             nl('religion', religion),
      citizenship:          nl('citizenship', citizenship),
      height:               nl('height', height),
      weight:               nl('weight', weight),
    };
    for (const k of Object.keys(update)) if (update[k] === undefined) delete update[k];   // never send absent keys as NULL
    // users.ctc is a display cache of the active salary structure; a competing edit here would only create a second,
    // silently-ignored salary (payroll reads employee_salary_structures). Structure wins; edit it in Payroll → Salary.
    if ((update.ctc !== undefined || update.salary_effective_date !== undefined) && await lifecycle.hasActiveSalaryStructure(targetId, orgId(req))) {
      delete update.ctc; delete update.salary_effective_date;
    }
    if (password) update.password = bcrypt.hashSync(password, 10);
    // branch_id is only written when explicitly supplied (validated above) — a partial
    // update must never erase the employee's branch.
    if (branchProvided) update.branch_id = nextBranchId;
    // Probation fields — only update if explicitly provided in the request body
    if (probation_applicable !== undefined) update.probation_applicable = probation_applicable;
    if (probation_months     !== undefined) update.probation_months     = parseInt(probation_months) || 0;

    // ── Backend enforcement of probation status ───────────────────────────────
    // If probation is being enabled, always force employee_status='probation'
    // regardless of what the frontend sent — single source of truth.
    if (probation_applicable === true) {
      update.employee_status = 'probation';
    }
    // If probation is being disabled, do NOT force a status — preserve whatever
    // the frontend sent (HR chose the correct new status in the form).

    // Auto-calculate probation dates from joining_date + probation_months.
    // If joining_date is not in this request, fall back to the DB value (COALESCE
    // with date_of_joining) so employees whose date lives in date_of_joining work too.
    if (probation_applicable === true && probation_months) {
      let effectiveJoining = joining_date || null;
      if (!effectiveJoining) {
        const { rows: jdRow } = await pool.query(
          `SELECT COALESCE(joining_date::text, date_of_joining) AS jd
             FROM users WHERE id = $1 AND organization_id = $2`,
          [parseInt(req.params.id), orgId(req)]
        );
        effectiveJoining = jdRow[0]?.jd || null;
      }
      const pd = lifecycle.computeProbationDates(effectiveJoining, probation_months);
      if (pd) { update.probation_start_date = pd.start; update.probation_end_date = pd.end; }
    } else if (probation_applicable === false) {
      update.probation_start_date = null;
      update.probation_end_date   = null;
    }

    // Sync the legacy `status` field with employee_status so the login check stays consistent.
    // login route blocks on `user.status === 'inactive'` independently of employee_status.
    // 'resigned' keeps access during the notice period (same as the Exit flow); only inactive/terminated lock the account.
    const _finalEmpStatus = update.employee_status;
    if (_finalEmpStatus !== undefined) update.status = lifecycle.legacyStatusFor(_finalEmpStatus);

    // The Employees-list bulk "Change Dept" (and Departments page move) sends only the department NAME.
    // Resolve it to the real department so the junction table (source of truth) moves with it. A body whose name
    // equals the current primary department (e.g. the birthday editor re-sending the whole row) changes nothing.
    let deptIdsToApply = Array.isArray(department_ids) ? department_ids : null;
    if (!deptIdsToApply && typeof department === 'string' && department.trim() && department !== tgt.department) {
      const dm = await pool.query('SELECT id FROM departments WHERE organization_id = $1 AND lower(name) = lower($2) LIMIT 1', [orgId(req), department.trim()]);
      if (dm.rows[0]) deptIdsToApply = [dm.rows[0].id];
    }

    // Auto-derive Work Location from branch when branch_id is being set and no explicit location provided.
    if (branchProvided && nextBranchId && !location) {
      try {
        const { rows: brRows } = await pool.query(
          `SELECT location FROM branches WHERE id = $1 AND org_id = $2 LIMIT 1`,
          [nextBranchId, orgId(req)]
        );
        if (brRows[0]?.location) update.location = brRows[0].location;
      } catch { /* non-fatal — location stays null */ }
    }

    // BUG_217: Capture the employee's current role BEFORE the update so we can detect
    // a role change and invalidate their active session immediately.
    const empId = parseInt(req.params.id);
    let previousRole = null;
    if (role !== undefined) {
      const { data: cur } = await db.from('users')
        .select('role').eq('id', empId).eq('organization_id', orgId(req)).maybeSingle();
      previousRole = cur?.role ?? null;
    }
    let data;

    if (deptIdsToApply) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const entries = Object.entries(update).filter(([, v]) => v !== undefined);
        if (entries.length) {
          const setClauses = entries.map(([k], i) => `"${k}" = $${i + 3}`).join(', ');
          const userRes = await client.query(
            `UPDATE users SET ${setClauses} WHERE id = $1 AND organization_id = $2 RETURNING *`,
            [empId, orgId(req), ...entries.map(([, v]) => v)]
          );
          data = userRes.rows[0];
        } else {
          data = (await client.query('SELECT * FROM users WHERE id = $1 AND organization_id = $2', [empId, orgId(req)])).rows[0];
        }

        // Guard: if nothing matched, empId belongs to another org — abort before touching the junction table.
        if (!data) throw new Error('Employee not found in this organisation');

        // Department assignment: junction (source of truth) + users.department text + users.department_id, atomically.
        const dep = await lifecycle.syncUserDepartments({ client, orgId: orgId(req), userId: empId, departmentIds: deptIdsToApply });
        data.department = dep.primaryName;
        data.department_id = dep.primaryId;
        delete data.password;

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else {
      // No department change — plain user update
      const cols = isAdminRole(req.user.role) ? EMPLOYEE_ADMIN_COLS : EMPLOYEE_PUBLIC_COLS;
      const q = Object.keys(update).length
        ? db.from('users').update(update).eq('id', empId).eq('organization_id', orgId(req))
        : db.from('users');
      const { data: updated, error } = await q.eq('id', empId).eq('organization_id', orgId(req)).select(cols).single();
      if (error) throw new Error(error.message);
      data = updated;
    }
    // An admin changing someone else's password ends that person's existing sessions (EMP-050).
    if (password && String(req.user.id) !== String(empId)) await revokeSessionsQuiet(empId);

    // Auto-sync device_enrollment_id → biometric_employee_map (shared with create).
    if (device_enrollment_id !== undefined) await lifecycle.syncBiometricPin({ orgId: orgId(req), userId: empId, pin: device_enrollment_id });

    // Status side-effects live in ONE place: session block/unblock, exit record + offboarding checklist when the
    // employee becomes resigned/terminated, closing a stale exit on reactivation. No-op when the status did not change.
    if (update.employee_status !== undefined) {
      await lifecycle.afterStatusChange({
        orgId: orgId(req), userId: empId, prev: tgt.employee_status || 'active',
        next: update.employee_status || 'active', actorId: req.user.id,
      });
    }

    // Manager / HOD team scope depends on department + branch.
    if (deptIdsToApply || branchProvided) require('../../services/teamScope').clearTeamScopeCache(orgId(req));

    // Department change ⇒ in-flight leave approvals follow the (new) department head.
    if (deptIdsToApply) {
      try { await require('../../services/leaveWorkflowEngine').reresolvePendingApprovers(orgId(req), [empId]); }
      catch (e) { console.error('[employees] reresolvePendingApprovers:', e.message); }
    }

    // BUG_217: If the role actually changed, the user's existing JWT still carries
    // the old role. Mark them for forced re-authentication so their next API call
    // returns 401 → frontend dispatches auth:expired → user is logged out and must
    // log back in to get a new token that reflects the updated role.
    // Also clear their permission cache so the new role's permissions take effect
    // immediately on re-login rather than waiting for the 5-minute TTL to expire.
    if (role !== undefined && previousRole !== null && role !== previousRole) {
      markRoleChanged(empId);
      clearUserCache(String(empId), orgId(req));
    }
    // The employee's own branch is part of their access model — drop any cached resolution.
    if (branchProvided) clearBranchAccessCache(empId, orgId(req));

    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Employees: Update Statutory Fields ──────────────────────────────────────
// PUT /api/employees/:id/statutory — admin only, accepts PF/ESI/OT statutory fields
router.put('/:id/statutory', auth, hasPermission('employees', 'edit'), withBranchContext, async (req, res) => {
  try {
    // Same org + branch authorization as the employee edit (PAN / Aadhaar / UAN are sensitive).
    if (req.user.role !== 'root_admin') {
      if (!await canAdminAccessUser(req.branchContext, parseInt(req.params.id, 10), orgId(req)))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
    }
    const {
      pf_applicable, pf_no, esi_applicable, esi_no,
      ot_applicable, ot_rate,
      aadhar_no, pan_number, uan_no,
    } = req.body;

    const update = {};
    if (pf_applicable  !== undefined) update.pf_applicable  = pf_applicable;
    if (pf_no          !== undefined) update.pf_no          = pf_no          || null;
    if (esi_applicable !== undefined) update.esi_applicable = esi_applicable;
    if (esi_no         !== undefined) update.esi_no         = esi_no         || null;
    if (ot_applicable  !== undefined) update.ot_applicable  = ot_applicable;
    if (ot_rate        !== undefined) update.ot_rate        = ot_rate        || null;
    if (aadhar_no      !== undefined) update.aadhar_no      = aadhar_no      || null;
    if (pan_number     !== undefined) update.pan_number     = pan_number     || null;
    if (uan_no         !== undefined) update.uan_no         = uan_no         || null;

    if (!Object.keys(update).length) {
      return res.status(400).json({ error: 'No statutory fields provided' });
    }

    const { data, error } = await db.from('users')
      .update(update)
      .eq('id', req.params.id)
      .eq('organization_id', orgId(req))
      .select('id, pf_applicable, pf_no, esi_applicable, esi_no, ot_applicable, ot_rate, aadhar_no, pan_number, uan_no')
      .single();
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Employees: Delete ────────────────────────────────────────────────────────
router.delete('/:id', auth, hasPermission('employees', 'delete'), withBranchContext, async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
    // Branch isolation: admin must have access to the target employee's branch.
    if (isAdminRole(req.user.role) && req.user.role !== 'root_admin') {
      if (!await canAdminAccessUser(req.branchContext, parseInt(req.params.id), orgId(req)))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
    }
    // Org-scoped pre-fetch prevents reading PII from another org's employee for the audit log
    const { data: emp } = await db.from('users').select('name, email, role').eq('id', req.params.id).eq('organization_id', orgId(req)).maybeSingle();
    if (!emp) return res.status(404).json({ error: 'Employee not found in this organisation' });
    if (req.user.role !== 'root_admin' && emp.role !== 'employee')
      return res.status(403).json({ error: 'Only root admins can delete HR admin or root admin accounts' });
    // A hard delete cascades to attendance, leaves, payslips, documents, exit and performance history (ON DELETE CASCADE).
    // An employee who has been paid must leave through the lifecycle (Resigned / Terminated → Exit → Exited) so payroll and
    // statutory records survive; hard delete stays available for mistaken records that never reached payroll.
    {
      const { rows: paid } = await pool.query('SELECT 1 FROM payslips WHERE user_id = $1 AND organization_id = $2 LIMIT 1', [req.params.id, orgId(req)]);
      if (paid.length) return res.status(409).json({ error: 'This employee has payroll history and cannot be deleted. Use Exit Management (resign / terminate) so the records are kept.' });
    }
    await db.from('users').delete().eq('id', req.params.id).eq('organization_id', orgId(req));
    // Log member removed event
    if (emp) {
      Promise.resolve(
        db.from('platform_activity').insert({ event_type: 'member_removed', organization_id: orgId(req), description: `Member removed: ${emp.name} (${emp.email})`, metadata: { name: emp.name, email: emp.email, org_id: orgId(req) } })
      ).catch(() => {});
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /employees/:id/avatar — admin uploads profile photo for any employee ─
// NOTE: isAdminRole(role) is a boolean helper, not middleware — using it as one never called
// next() and the request hung. Admin check + org/branch authorization are explicit here.
router.post('/:id/avatar', auth, withBranchContext, upload.single('file'), async (req, res) => {
  try {
    if (!isAdminRole(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
    if (req.user.role !== 'root_admin') {
      if (!await canAdminAccessUser(req.branchContext, parseInt(req.params.id, 10), orgId(req)))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          folder: `hrms/${orgId(req)}/avatars`,
          resource_type: 'image',
          transformation: [{ width: 200, height: 200, crop: 'fill', gravity: 'face' }],
        },
        (err, r) => err ? reject(err) : resolve(r)
      ).end(req.file.buffer);
    });
    const { error } = await db.from('users')
      .update({ avatar_url: result.secure_url, profile_photo_url: result.secure_url })
      .eq('id', req.params.id)
      .eq('organization_id', orgId(req));
    if (error) throw new Error(error.message);
    res.json({ avatar_url: result.secure_url, profile_photo_url: result.secure_url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /employees/me/avatar — employee uploads their own profile photo ──────
router.post('/me/avatar', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          folder: `hrms/${orgId(req)}/avatars`,
          resource_type: 'image',
          transformation: [{ width: 200, height: 200, crop: 'fill', gravity: 'face' }],
        },
        (err, r) => err ? reject(err) : resolve(r)
      ).end(req.file.buffer);
    });
    const { error } = await db.from('users')
      .update({ avatar_url: result.secure_url, profile_photo_url: result.secure_url })
      .eq('id', req.user.id);
    if (error) throw new Error(error.message);
    res.json({ avatar_url: result.secure_url, profile_photo_url: result.secure_url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Send Login Credentials ───────────────────────────────────────────────────
// Generates a secure temp password, stores it hashed, forces password change,
// emails the employee, and logs the action. Safe to call multiple times.
router.post('/:id/send-credentials', auth, withBranchContext, async (req, res) => {
  try {
    if (!isAdminRole(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
    // Branch isolation: admin must have access to the target employee's branch.
    if (req.user.role !== 'root_admin') {
      if (!await canAdminAccessUser(req.branchContext, parseInt(req.params.id, 10), req.user.organization_id))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
    }
    const oId   = orgId(req);
    const empId = parseInt(req.params.id, 10);

    // Ensure last_credentials_sent_at column exists (idempotent)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_credentials_sent_at TIMESTAMPTZ`).catch(() => {});

    // Fetch employee — must belong to this org
    const { data: emp } = await db.from('users')
      .select('id, name, email, department, position, role, status')
      .eq('id', empId)
      .eq('organization_id', oId)
      .maybeSingle();

    if (!emp)        return res.status(404).json({ error: 'Employee not found in your organization' });
    // Resetting an admin account's password would be an account takeover for non-root callers.
    if (req.user.role !== 'root_admin' && emp.role !== 'employee')
      return res.status(403).json({ error: 'Only root admins can send credentials to admin accounts' });
    if (!emp.email)  return res.status(400).json({ error: 'Employee has no email address on record' });
    if (emp.status === 'inactive') return res.status(400).json({ error: 'Cannot send credentials to a deactivated account' });

    // Generate a secure 12-char temp password (letters + digits + symbols, avoidng ambiguous chars)
    const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&';
    const tempPassword = Array.from(crypto.randomBytes(12))
      .map(b => CHARSET[b % CHARSET.length]).join('');

    const hashed    = bcrypt.hashSync(tempPassword, 10);
    const sentAt    = new Date().toISOString();

    // Update password + force change flag + timestamp (atomic)
    await db.from('users').update({
      password:                 hashed,
      force_password_change:    true,
      last_credentials_sent_at: sentAt,
    }).eq('id', empId).eq('organization_id', oId);
    // Password reset by an admin must end any session the old password opened (EMP-050).
    await revokeSessionsQuiet(empId);

    // Audit log (fire-and-forget)
    db.from('platform_activity').insert({
      event_type:      'credentials_sent',
      organization_id: oId,
      description:     `Login credentials sent to ${emp.name} (${emp.email}) by ${req.user.name}`,
      metadata:        { employee_id: empId, sent_by: req.user.id, sent_by_name: req.user.name, sent_at: sentAt },
    }).then(() => {}).catch(() => {});

    // Fetch org context for email
    const { orgName, orgEmail } = await getOrgContext(oId);
    const portalUrl = process.env.FRONTEND_URL || 'https://hrms.lumoslogic.com';

    sendMail({
      to:      emp.email,
      subject: `Your ${orgName || 'HRMS'} Login Credentials`,
      html:    credentialsEmailHtml({ employee: emp, tempPassword, orgName, orgEmail, portalUrl }),
    }).catch(() => {});

    res.json({
      success:                  true,
      message:                  `Login credentials sent to ${emp.email}`,
      last_credentials_sent_at: sentAt,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
