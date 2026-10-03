const { db } = require('../config/db');

function localDateStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

function localTimeStr(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const h = parts.find(p => p.type === 'hour')?.value ?? '00';
  const m = parts.find(p => p.type === 'minute')?.value ?? '00';
  return `${h.padStart(2,'0')}:${m.padStart(2,'0')}`;
}

function flat(records, joinKey = 'users') {
  return (records || []).map(r => {
    const joined = r[joinKey] || {};
    const copy   = { ...r, ...joined };
    delete copy[joinKey];
    return copy;
  });
}

function flatOne(record, joinKey = 'users') {
  if (!record) return null;
  const joined = record[joinKey] || {};
  const copy   = { ...record, ...joined };
  delete copy[joinKey];
  return copy;
}

async function getSettings(orgId) {
  let q = db.from('work_schedule').select('*').limit(1);
  if (orgId) q = q.eq('organization_id', orgId);
  try {
    const { data } = await q.single();
    if (data) return data;
  } catch { }
  // No schedule row for THIS org: use neutral defaults. Never fall back to another
  // organisation's schedule (cross-tenant leak).
  return {
    start_time: '09:00', end_time: '18:00', late_threshold: '09:30', early_exit_threshold: '17:00',
    half_day_hours: 4.5, full_day_hours: 8, work_days: '1,2,3,4,5', max_early_leave_count: 3,
    late_entry_threshold_enabled: true, early_exit_threshold_enabled: true,
  };
}

// The organisation always comes from the authenticated JWT. There is deliberately no
// default organisation: a request without one must fail, not silently act on org 1.
function orgId(req) {
  const id = req.user?.organization_id;
  if (id === undefined || id === null || id === '') throw new Error('Missing organisation context');
  return id;
}

function toMinutes(t) {
  const [h, m] = (t || '00:00').split(':').map(Number);
  return h * 60 + m;
}

function isWorkingDay(dateStr, settings) {
  const day = new Date(dateStr + 'T12:00:00').getDay();
  return (settings.work_days || '1,2,3,4,5').split(',').map(Number).includes(day);
}

async function getRecipients(oId) {
  try {
    let q = db.from('notification_recipients').select('email').eq('active', true);
    if (oId) q = q.eq('organization_id', oId);
    const { data } = await q;
    if (data && data.length > 0) return data.map(r => r.email).filter(Boolean);
  } catch { }
  try {
    let adminQuery = db.from('users').select('email').in('role', ['admin', 'root_admin']);
    if (oId) adminQuery = adminQuery.eq('organization_id', oId);
    const { data: admins } = await adminQuery;
    if (admins && admins.length > 0) return admins.map(a => a.email).filter(Boolean);
  } catch { }
  return [];
}

// Generates a URL-safe slug from a company name, guaranteed unique in the organizations table.
// Tries: base → base-YYYY → base-2 … base-99 → base-<timestamp>
async function generateUniqueSlug(companyName) {
  const base = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  const taken = async (slug) => {
    const { data } = await db.from('organizations').select('id').eq('slug', slug).maybeSingle();
    return !!data;
  };

  if (!(await taken(base))) return base;

  const withYear = `${base}-${new Date().getFullYear()}`;
  if (!(await taken(withYear))) return withYear;

  for (let i = 2; i <= 99; i++) {
    const candidate = `${base}-${i}`;
    if (!(await taken(candidate))) return candidate;
  }

  return `${base}-${Date.now()}`;
}

// Returns { orgName, orgEmail } for use in email templates.
// orgEmail is the first active HR admin (role='admin') email — not root_admin.
async function getOrgContext(oId) {
  try {
    const [orgRes, hrRes] = await Promise.all([
      db.from('organizations').select('name').eq('id', oId).maybeSingle(),
      db.from('users')
        .select('email')
        .eq('organization_id', oId)
        .eq('role', 'admin')
        .neq('status', 'inactive')
        .order('created_at', { ascending: true })
        .limit(1),
    ]);
    const hrEmails = Array.isArray(hrRes.data) ? hrRes.data : (hrRes.data ? [hrRes.data] : []);
    return {
      orgName:  orgRes.data?.name || '',
      orgEmail: hrEmails[0]?.email || process.env.SMTP_USER || '',
    };
  } catch {
    return { orgName: '', orgEmail: process.env.SMTP_USER || '' };
  }
}

/**
 * Convenience wrapper: looks up the employee's branch_id then delegates to
 * getEffectiveWorkSchedule. Use this in any route where you have the employee's
 * userId but not their branch_id.
 *
 * Falls back to org-wide work_schedule when:
 *   - userId is null/undefined
 *   - user has no branch_id
 *   - branch_work_schedule table doesn't exist yet
 *   - no branch override exists for that branch
 */
async function getSettingsForUser(orgId, userId) {
  if (userId) {
    try {
      const { data: user } = await db
        .from('users')
        .select('branch_id')
        .eq('id', userId)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (user?.branch_id) {
        return getEffectiveWorkSchedule(orgId, user.branch_id);
      }
    } catch { /* DB error — fall through to org default */ }
  }
  return getSettings(orgId);
}

/**
 * Returns the effective work schedule for an employee.
 * If the employee belongs to a branch that has a branch_work_schedule override,
 * that override is returned. Otherwise the org-wide work_schedule is used.
 *
 * branchId = null/undefined → always returns org-wide schedule (unchanged behavior).
 * Branch table does not exist yet (pre-migration) → falls back to org-wide schedule.
 * No row found for branch → falls back to org-wide schedule.
 *
 * This is the single resolver all branch-aware consumers should call.
 */
async function getEffectiveWorkSchedule(orgId, branchId) {
  if (branchId) {
    try {
      const { data } = await db
        .from('branch_work_schedule')
        .select('*')
        .eq('organization_id', orgId)
        .eq('branch_id', branchId)
        .maybeSingle();
      if (data) return data;
    } catch { /* table not yet created — fall through to org default */ }
  }
  return getSettings(orgId);
}

// Branch of one employee (null when none / branches not in use).
async function getUserBranchId(oId, userId) {
  try {
    const { data } = await db.from('users').select('branch_id')
      .eq('id', userId).eq('organization_id', oId).maybeSingle();
    return data?.branch_id != null ? Number(data.branch_id) : null;
  } catch { return null; }
}

// A holiday row applies to an employee when it is organisation-wide (branch_id NULL) or
// belongs to the employee's own branch.
function holidayAppliesToBranch(holiday, branchId) {
  return holiday.branch_id == null || (branchId != null && Number(holiday.branch_id) === Number(branchId));
}

module.exports = { getUserBranchId, holidayAppliesToBranch, localDateStr, localTimeStr, flat, flatOne, getSettings, getEffectiveWorkSchedule, getSettingsForUser, orgId, toMinutes, isWorkingDay, getRecipients, generateUniqueSlug, getOrgContext };
