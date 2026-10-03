/**
 * configGroupService.js
 *
 * Configuration groups: one shared configuration applied to several branches.
 *
 *   effective configuration (most specific wins):
 *       branch custom override   →   configuration group   →   organisation default
 *
 * A group's configuration is stored once (config_group_work_schedule / config_group_leave_policies)
 * and WRITTEN THROUGH into the existing per-branch rows, tagged with group_id:
 *
 *       row.group_id IS NULL     the branch's own custom override  (never touched by a group)
 *       row.group_id = <group>   inherited from that group         (owned by the group)
 *
 * Every existing reader (attendance, payroll, biometric, regularization, leaves) already reads the
 * per-branch rows, so they keep working unchanged while a group edit reaches every member branch.
 *
 * A branch belongs to AT MOST ONE group per domain (UNIQUE (org_id, domain, branch_id) in the DB;
 * the API pre-checks to give a readable error).
 *
 * All functions take `q`, anything with .query(sql, params) — the pool or a transaction client — so
 * callers can run them inside their own transaction.
 */
const { pool } = require('../config/db');

const DOMAINS = ['work_schedule', 'leave_policies'];

const WORK_SCHEDULE_FIELDS = [
  'start_time', 'end_time', 'late_threshold', 'early_exit_threshold', 'half_day_hours', 'work_days',
  'full_day_hours', 'max_early_leave_count', 'late_entry_threshold_enabled', 'early_exit_threshold_enabled',
];
const WORK_SCHEDULE_DEFAULTS = {
  start_time: '09:00', end_time: '18:00', late_threshold: '09:30', early_exit_threshold: '17:00',
  half_day_hours: 4.5, full_day_hours: 8, work_days: '1,2,3,4,5', max_early_leave_count: 3,
  late_entry_threshold_enabled: true, early_exit_threshold_enabled: true,
};
const POLICY_FIELDS = [
  'label', 'annual_quota', 'carry_forward', 'max_carry_forward', 'paid', 'active',
  'half_day_allowed', 'requires_approval', 'require_document', 'min_notice_days',
  'max_consecutive_days', 'description',
];
// Same defaults the Leave Policies page shows for an org that never saved any.
const DEFAULT_POLICIES = [
  { leave_type: 'annual',    label: 'Annual Leave',    annual_quota: 18, carry_forward: true,  max_carry_forward: 5, paid: true },
  { leave_type: 'sick',      label: 'Sick Leave',      annual_quota: 12, carry_forward: false, max_carry_forward: 0, paid: true },
  { leave_type: 'casual',    label: 'Casual Leave',    annual_quota: 8,  carry_forward: false, max_carry_forward: 0, paid: true },
  { leave_type: 'emergency', label: 'Emergency Leave', annual_quota: 3,  carry_forward: false, max_carry_forward: 0, paid: true },
  { leave_type: 'maternity', label: 'Maternity Leave', annual_quota: 180, carry_forward: false, max_carry_forward: 0, paid: true },
  { leave_type: 'paternity', label: 'Paternity Leave', annual_quota: 15, carry_forward: false, max_carry_forward: 0, paid: true },
  { leave_type: 'comp_off',  label: 'Comp Off',        annual_quota: 0,  carry_forward: false, max_carry_forward: 0, paid: true },
];

// True once migration branch_separation_2026_10_03.sql (section 4) has been applied. Cached briefly so the
// override endpoints can stay backward compatible with a database that has not been migrated yet.
let _avail = { value: null, exp: 0 };
async function groupsAvailable(q = pool) {
  if (_avail.value !== null && _avail.exp > Date.now()) return _avail.value;
  let value = false;
  try {
    const { rows } = await q.query(
      `SELECT
         (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = current_schema() AND column_name = 'group_id'
             AND table_name IN ('leave_policies', 'branch_work_schedule'))::int AS cols,
         (to_regclass('config_groups') IS NOT NULL) AS tbl`);
    value = rows[0].cols === 2 && rows[0].tbl === true;
  } catch { value = false; }
  _avail = { value, exp: Date.now() + 30 * 1000 };
  return value;
}
function resetGroupsAvailableCache() { _avail = { value: null, exp: 0 }; }

class GroupError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; Object.assign(this, extra || {}); }
}

// ── reads ──────────────────────────────────────────────────────────────────────────────────

async function listGroups(q, orgId, domain) {
  const { rows: groups } = await q.query(
    `SELECT id, domain, name, created_at, updated_at FROM config_groups
      WHERE org_id = $1 AND ($2::text IS NULL OR domain = $2) ORDER BY domain, name`, [orgId, domain || null]);
  if (!groups.length) return [];
  const { rows: members } = await q.query(
    `SELECT group_id, branch_id FROM config_group_branches WHERE org_id = $1 AND group_id = ANY($2::bigint[])`,
    [orgId, groups.map(g => g.id)]);
  return groups.map(g => ({ ...g, branch_ids: members.filter(m => String(m.group_id) === String(g.id)).map(m => Number(m.branch_id)) }));
}

async function getGroup(q, orgId, groupId) {
  const id = Number(groupId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const { rows } = await q.query('SELECT id, domain, name FROM config_groups WHERE id = $1 AND org_id = $2', [id, orgId]);
  return rows[0] || null;
}

/** The group (if any) a branch belongs to for a domain. */
async function getBranchGroup(q, orgId, domain, branchId) {
  const { rows } = await q.query(
    `SELECT g.id, g.name FROM config_group_branches m JOIN config_groups g ON g.id = m.group_id
      WHERE m.org_id = $1 AND m.domain = $2 AND m.branch_id = $3`, [orgId, domain, branchId]);
  return rows[0] || null;
}

/** Where a branch's effective configuration comes from: 'branch' (custom) | 'group' | 'org'. */
async function getEffectiveSource(q, orgId, domain, branchId) {
  if (domain === 'work_schedule') {
    const { rows } = await q.query('SELECT group_id FROM branch_work_schedule WHERE organization_id = $1 AND branch_id = $2', [orgId, branchId]);
    if (!rows.length) return { source: 'org', group: null };
    if (rows[0].group_id == null) return { source: 'branch', group: await getBranchGroup(q, orgId, domain, branchId) };
    return { source: 'group', group: await getBranchGroup(q, orgId, domain, branchId) };
  }
  const { rows } = await q.query('SELECT DISTINCT group_id FROM leave_policies WHERE organization_id = $1 AND branch_id = $2', [orgId, branchId]);
  if (!rows.length) return { source: 'org', group: null };
  if (rows.some(r => r.group_id == null)) return { source: 'branch', group: await getBranchGroup(q, orgId, domain, branchId) };
  return { source: 'group', group: await getBranchGroup(q, orgId, domain, branchId) };
}

async function getGroupConfig(q, orgId, group) {
  if (group.domain === 'work_schedule') {
    const { rows } = await q.query('SELECT * FROM config_group_work_schedule WHERE group_id = $1', [group.id]);
    return rows[0] || null;
  }
  const { rows } = await q.query('SELECT * FROM config_group_leave_policies WHERE group_id = $1 ORDER BY leave_type', [group.id]);
  return rows;
}

// ── write-through ──────────────────────────────────────────────────────────────────────────

/** Does this branch have its OWN custom configuration (which a group must never overwrite)? */
async function hasCustomOverride(q, orgId, domain, branchId) {
  if (domain === 'work_schedule') {
    const { rows } = await q.query(
      'SELECT 1 FROM branch_work_schedule WHERE organization_id = $1 AND branch_id = $2 AND group_id IS NULL', [orgId, branchId]);
    return rows.length > 0;
  }
  const { rows } = await q.query(
    'SELECT 1 FROM leave_policies WHERE organization_id = $1 AND branch_id = $2 AND group_id IS NULL LIMIT 1', [orgId, branchId]);
  return rows.length > 0;
}

/** Remove the rows a branch inherited from a group (custom rows are never touched). */
async function removeDerived(q, orgId, domain, branchId, groupId = null) {
  const gClause = groupId == null ? 'group_id IS NOT NULL' : 'group_id = $3';
  const params = groupId == null ? [orgId, branchId] : [orgId, branchId, groupId];
  const table = domain === 'work_schedule' ? 'branch_work_schedule' : 'leave_policies';
  await q.query(`DELETE FROM ${table} WHERE organization_id = $1 AND branch_id = $2 AND ${gClause}`, params);
}

/**
 * Re-apply a branch's group configuration (if it is in a group and has no custom override), or clear
 * its inherited rows (if it is in no group). Idempotent. Returns 'applied' | 'custom' | 'cleared'.
 */
async function propagateBranch(q, orgId, domain, branchId) {
  const group = await getBranchGroup(q, orgId, domain, branchId);
  if (!group) { await removeDerived(q, orgId, domain, branchId); return 'cleared'; }
  if (await hasCustomOverride(q, orgId, domain, branchId)) return 'custom';

  if (domain === 'work_schedule') {
    const cfg = await getGroupConfig(q, orgId, { id: group.id, domain });
    if (!cfg) { await removeDerived(q, orgId, domain, branchId); return 'cleared'; }
    const cols = WORK_SCHEDULE_FIELDS;
    const vals = cols.map(c => cfg[c]);
    await q.query(
      `INSERT INTO branch_work_schedule (organization_id, branch_id, group_id, ${cols.join(', ')}, updated_at)
       VALUES ($1, $2, $3, ${cols.map((_, i) => `$${i + 4}`).join(', ')}, NOW())
       ON CONFLICT (organization_id, branch_id) DO UPDATE SET
         group_id = EXCLUDED.group_id, ${cols.map(c => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = NOW()
       WHERE branch_work_schedule.group_id IS NOT NULL`,
      [orgId, branchId, group.id, ...vals]);
    return 'applied';
  }

  const rows = await getGroupConfig(q, orgId, { id: group.id, domain });
  await removeDerived(q, orgId, domain, branchId);
  for (const p of rows) {
    await q.query(
      `INSERT INTO leave_policies
         (organization_id, branch_id, group_id, leave_type, label, annual_quota, carry_forward, max_carry_forward,
          paid, active, half_day_allowed, requires_approval, require_document, min_notice_days, max_consecutive_days, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [orgId, branchId, group.id, p.leave_type, p.label, p.annual_quota, p.carry_forward, p.max_carry_forward,
       p.paid, p.active, p.half_day_allowed, p.requires_approval, p.require_document, p.min_notice_days,
       p.max_consecutive_days, p.description]);
  }
  return 'applied';
}

/** Re-apply a group's configuration to every member branch. Returns { applied: [], custom: [] }. */
async function propagateGroup(q, orgId, group) {
  const { rows } = await q.query('SELECT branch_id FROM config_group_branches WHERE group_id = $1 AND org_id = $2', [group.id, orgId]);
  const out = { applied: [], custom: [] };
  for (const r of rows) {
    const res = await propagateBranch(q, orgId, group.domain, Number(r.branch_id));
    (res === 'custom' ? out.custom : out.applied).push(Number(r.branch_id));
  }
  return out;
}

// ── validation helpers ─────────────────────────────────────────────────────────────────────

/** Every branch must exist in this org and must not already be in ANOTHER group of this domain. */
async function assertBranchesAssignable(q, orgId, domain, branchIds, exceptGroupId = null) {
  const ids = [...new Set((branchIds || []).map(Number))];
  if (ids.some(n => !Number.isInteger(n) || n <= 0)) throw new GroupError(400, 'Invalid branch id');
  if (!ids.length) return ids;
  const { rows: ok } = await q.query('SELECT id FROM branches WHERE org_id = $1 AND id = ANY($2::bigint[])', [orgId, ids]);
  if (ok.length !== ids.length) throw new GroupError(404, 'One or more branches do not belong to your organisation.');
  const { rows: clash } = await q.query(
    `SELECT m.branch_id, g.name FROM config_group_branches m JOIN config_groups g ON g.id = m.group_id
      WHERE m.org_id = $1 AND m.domain = $2 AND m.branch_id = ANY($3::bigint[]) AND ($4::bigint IS NULL OR m.group_id <> $4)`,
    [orgId, domain, ids, exceptGroupId]);
  if (clash.length) {
    throw new GroupError(409, `A branch can belong to only one ${domain.replace('_', ' ')} group. Already in a group: ` +
      clash.map(c => `branch ${c.branch_id} ("${c.name}")`).join(', '), { clash });
  }
  return ids;
}

function cleanWorkSchedule(body) {
  const out = {};
  for (const k of WORK_SCHEDULE_FIELDS) if (body[k] !== undefined) out[k] = body[k];
  return out;
}

function cleanPolicies(policies) {
  if (!Array.isArray(policies) || !policies.length) throw new GroupError(400, 'policies array required and must not be empty');
  const seen = new Set();
  return policies.map(p => {
    if (!p || !p.leave_type) throw new GroupError(400, 'Each policy must have a leave_type.');
    if (seen.has(p.leave_type)) throw new GroupError(400, `Duplicate leave type "${p.leave_type}".`);
    seen.add(p.leave_type);
    const label = String(p.label ?? '').trim();
    if (!label) throw new GroupError(400, 'Leave Name cannot be empty.');
    if (label.length > 100) throw new GroupError(400, 'Leave Name is too long (max 100 characters).');
    return {
      leave_type: p.leave_type, label,
      annual_quota: Number(p.annual_quota) || 0, carry_forward: !!p.carry_forward, max_carry_forward: Number(p.max_carry_forward) || 0,
      paid: p.paid !== false, active: p.active !== false, half_day_allowed: p.half_day_allowed !== false,
      requires_approval: p.requires_approval !== false, require_document: !!p.require_document,
      min_notice_days: Number(p.min_notice_days) || 0, max_consecutive_days: Number(p.max_consecutive_days) || 0,
      description: p.description || '',
    };
  });
}

// ── group writes (call inside a transaction) ───────────────────────────────────────────────

/** Seed configuration for a new group: a branch's effective config, else the org default. */
async function seedConfig(q, orgId, domain, fromBranchId) {
  if (domain === 'work_schedule') {
    let row = null;
    if (fromBranchId != null) {
      ({ rows: [row] } = await q.query('SELECT * FROM branch_work_schedule WHERE organization_id = $1 AND branch_id = $2', [orgId, fromBranchId]));
    }
    if (!row) ({ rows: [row] } = await q.query('SELECT * FROM work_schedule WHERE organization_id = $1 LIMIT 1', [orgId]));
    const cfg = { ...WORK_SCHEDULE_DEFAULTS };
    if (row) for (const k of WORK_SCHEDULE_FIELDS) if (row[k] !== undefined && row[k] !== null) cfg[k] = row[k];
    return cfg;
  }
  let rows = [];
  if (fromBranchId != null) ({ rows } = await q.query('SELECT * FROM leave_policies WHERE organization_id = $1 AND branch_id = $2', [orgId, fromBranchId]));
  if (!rows.length) ({ rows } = await q.query('SELECT * FROM leave_policies WHERE organization_id = $1 AND branch_id IS NULL', [orgId]));
  if (!rows.length) rows = DEFAULT_POLICIES;
  return cleanPolicies(rows);
}

async function writeGroupConfig(q, group, config) {
  if (group.domain === 'work_schedule') {
    const cols = WORK_SCHEDULE_FIELDS;
    const full = { ...WORK_SCHEDULE_DEFAULTS, ...config };
    await q.query(
      `INSERT INTO config_group_work_schedule (group_id, ${cols.join(', ')}, updated_at)
       VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}, NOW())
       ON CONFLICT (group_id) DO UPDATE SET ${cols.map(c => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = NOW()`,
      [group.id, ...cols.map(c => full[c])]);
    return;
  }
  await q.query('DELETE FROM config_group_leave_policies WHERE group_id = $1', [group.id]);
  for (const p of config) {
    await q.query(
      `INSERT INTO config_group_leave_policies
         (group_id, leave_type, label, annual_quota, carry_forward, max_carry_forward, paid, active, half_day_allowed,
          requires_approval, require_document, min_notice_days, max_consecutive_days, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [group.id, p.leave_type, p.label, p.annual_quota, p.carry_forward, p.max_carry_forward, p.paid, p.active,
       p.half_day_allowed, p.requires_approval, p.require_document, p.min_notice_days, p.max_consecutive_days, p.description]);
  }
}

async function createGroup(q, { orgId, domain, name, branchIds, fromBranchId = null, createdBy = null }) {
  if (!DOMAINS.includes(domain)) throw new GroupError(400, `domain must be one of: ${DOMAINS.join(', ')}`);
  const nm = String(name || '').trim();
  if (!nm) throw new GroupError(400, 'Group name is required');
  if (nm.length > 100) throw new GroupError(400, 'Group name is too long (max 100 characters)');
  const ids = await assertBranchesAssignable(q, orgId, domain, branchIds);
  const config = await seedConfig(q, orgId, domain, fromBranchId);
  let group;
  try {
    ({ rows: [group] } = await q.query(
      'INSERT INTO config_groups (org_id, domain, name, created_by) VALUES ($1,$2,$3,$4) RETURNING id, domain, name', [orgId, domain, nm, createdBy]));
  } catch (e) {
    if (e.code === '23505') throw new GroupError(409, `A ${domain.replace('_', ' ')} group named "${nm}" already exists.`);
    throw e;
  }
  await writeGroupConfig(q, group, config);
  for (const b of ids) {
    await q.query('INSERT INTO config_group_branches (group_id, domain, org_id, branch_id) VALUES ($1,$2,$3,$4)', [group.id, domain, orgId, b]);
  }
  const result = await propagateGroup(q, orgId, group);
  return { group, ...result };
}

/** Replace the member set. Removed branches lose their inherited rows; added ones receive the config. */
async function setMembers(q, orgId, group, branchIds) {
  const ids = await assertBranchesAssignable(q, orgId, group.domain, branchIds, group.id);
  const { rows: cur } = await q.query('SELECT branch_id FROM config_group_branches WHERE group_id = $1', [group.id]);
  const before = new Set(cur.map(r => Number(r.branch_id)));
  const after = new Set(ids);
  const removed = [...before].filter(b => !after.has(b));
  for (const b of removed) {
    await q.query('DELETE FROM config_group_branches WHERE group_id = $1 AND branch_id = $2', [group.id, b]);
    await removeDerived(q, orgId, group.domain, b, group.id);
  }
  for (const b of ids.filter(b => !before.has(b))) {
    await q.query('INSERT INTO config_group_branches (group_id, domain, org_id, branch_id) VALUES ($1,$2,$3,$4)', [group.id, group.domain, orgId, b]);
  }
  const result = await propagateGroup(q, orgId, group);
  return { removed, ...result };
}

async function deleteGroup(q, orgId, group) {
  const { rows } = await q.query('SELECT branch_id FROM config_group_branches WHERE group_id = $1', [group.id]);
  for (const r of rows) await removeDerived(q, orgId, group.domain, Number(r.branch_id), group.id);
  await q.query('DELETE FROM config_groups WHERE id = $1 AND org_id = $2', [group.id, orgId]); // members/config cascade
  return { released: rows.map(r => Number(r.branch_id)) };
}

module.exports = {
  GroupError, DOMAINS, WORK_SCHEDULE_FIELDS, WORK_SCHEDULE_DEFAULTS, POLICY_FIELDS, DEFAULT_POLICIES,
  listGroups, getGroup, getBranchGroup, getEffectiveSource, getGroupConfig,
  hasCustomOverride, removeDerived, propagateBranch, propagateGroup,
  assertBranchesAssignable, cleanWorkSchedule, cleanPolicies, writeGroupConfig,
  createGroup, setMembers, deleteGroup,
  groupsAvailable, resetGroupsAvailableCache,
  pool,
};
