const express = require('express');
const router  = express.Router();
const { db, pool } = require('../../config/db');
const { auth } = require('../../middleware/auth');
const { hasPermission } = require('../../middleware/permissions');
const { withBranchContext } = require('../../middleware/branchContext');
const { resolveEmployeeIds } = require('../../utils/branchFilter');

function isAdmin(role) { return role === 'admin' || role === 'root_admin'; }

const DEFAULT_TASKS = [
  // ── Employee tasks ────────────────────────────────────────────────────────
  { title: 'Complete Personal Information Form',                              assigned_to: 'employee', order_index: 1  },
  { title: 'Upload Aadhaar Card / ID Proof',                                  assigned_to: 'employee', order_index: 2  },
  { title: 'Upload Address Proof',                                            assigned_to: 'employee', order_index: 3  },
  { title: 'Provide Bank Account Details',                                    assigned_to: 'employee', order_index: 4  },
  { title: 'Read & Acknowledge Company Policies',                             assigned_to: 'employee', order_index: 5  },
  // ── HR tasks ──────────────────────────────────────────────────────────────
  { title: 'Verify Documents',                                                assigned_to: 'hr',       order_index: 6  },
  { title: 'Create Company Email',                                            assigned_to: 'hr',       order_index: 7  },
  { title: 'Create HRMS Account',                                             assigned_to: 'hr',       order_index: 8  },
  { title: 'Complete HR Orientation',                                         assigned_to: 'hr',       order_index: 9  },
  { title: 'Assign Buddy / Mentor',                                           assigned_to: 'hr',       order_index: 10 },
  // ── IT tasks ──────────────────────────────────────────────────────────────
  { title: 'Laptop & Equipment Setup',                                        assigned_to: 'it',       order_index: 11 },
  { title: 'Software & Tool Access',                                          assigned_to: 'it',       order_index: 12 },
  // ── Manager tasks ─────────────────────────────────────────────────────────
  { title: 'Meet Reporting Manager',                                          assigned_to: 'manager',  order_index: 13 },
  { title: 'Team Introduction',                                               assigned_to: 'manager',  order_index: 14 },
  { title: 'Assign First Task',                                               assigned_to: 'manager',  order_index: 15 },
  { title: 'Complete First Week Review',                                      assigned_to: 'manager',  order_index: 16 },
];

// GET /api/onboarding
router.get('/', auth, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { userId } = req.query;
    const targetId = isAdmin(req.user.role) && userId ? userId : req.user.id;
    const { data, error } = await db.from('onboarding_checklists')
      .select('*').eq('user_id', targetId).eq('organization_id', oId).order('order_index');
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/onboarding/overview
router.get('/overview', auth, withBranchContext, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const oId = req.user.organization_id;

    // Resolve branch-scoped employee IDs before querying checklists
    const empIds = await resolveEmployeeIds(req.branchContext, oId);
    if (empIds !== null && empIds.length === 0) return res.json([]);

    let checklistQuery = db.from('onboarding_checklists')
      .select('*').eq('organization_id', oId).order('created_at', { ascending: false });
    if (empIds !== null) checklistQuery = checklistQuery.in('user_id', empIds);

    const { data, error } = await checklistQuery;
    if (error) throw error;

    const rows = data || [];
    if (rows.length === 0) return res.json([]);

    const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
    // BUG_158: exclude inactive/resigned/terminated employees from onboarding list
    // joining_date (DATE, sanghavi_migration) exists on Relitrade; date_of_joining (TEXT,
    // hrms_full_migration) exists on all deployments. Probe once and prefer joining_date.
    const colCheck = await pool.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'joining_date' LIMIT 1
    `);
    const joinCol = colCheck.rows.length > 0 ? 'joining_date' : 'date_of_joining';

    const { data: users } = await db.from('users')
      .select(`id, name, avatar_color, department, ${joinCol}, employee_status`)
      .in('id', userIds)
      .not('employee_status', 'in', '("inactive","resigned","terminated")');
    const uMap = {};
    (users || []).forEach(u => {
      // Normalize to joining_date so the frontend field name is always consistent
      if (joinCol === 'date_of_joining' && u.date_of_joining !== undefined) {
        u.joining_date = u.date_of_joining;
      }
      uMap[u.id] = u;
    });

    const grouped = {};
    rows.forEach(task => {
      const uid = task.user_id;
      if (!uMap[uid]) return; // skip inactive/terminated employees (not in uMap)
      if (!grouped[uid]) grouped[uid] = { user: uMap[uid], tasks: [], completed: 0, total: 0 };
      grouped[uid].tasks.push(task);
      grouped[uid].total++;
      if (task.completed) grouped[uid].completed++;
    });
    res.json(Object.values(grouped));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/onboarding/init/:userId
// Uses SELECT FOR UPDATE on the user row to serialize concurrent init requests.
// All 16 tasks are inserted inside a single transaction — either all succeed or none.
router.post('/init/:userId', auth, hasPermission('onboarding', 'manage'), async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
  const oId = req.user.organization_id;
  const uid = parseInt(req.params.userId);

  const client = await pool.connect();
  let inserted;
  try {
    await client.query('BEGIN');

    // Lock the user row — prevents two concurrent init calls from both passing the existence check
    const userRes = await client.query(
      `SELECT id FROM users WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [uid, oId]
    );
    if (!userRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Re-check existence inside the transaction (TOCTOU prevention)
    const existRes = await client.query(
      `SELECT id FROM onboarding_checklists WHERE user_id = $1 AND organization_id = $2 LIMIT 1`,
      [uid, oId]
    );
    if (existRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Onboarding already initialized for this employee.' });
    }

    // Insert all 16 tasks atomically
    inserted = [];
    for (const task of DEFAULT_TASKS) {
      const r = await client.query(
        `INSERT INTO onboarding_checklists
           (user_id, organization_id, title, assigned_to, order_index)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [uid, oId, task.title, task.assigned_to, task.order_index]
      );
      inserted.push(r.rows[0]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'Onboarding init failed — no tasks created. ' + err.message });
  } finally {
    client.release();
  }

  // Fire-and-forget notification after COMMIT
  db.from('notifications').insert({
    user_id: uid,
    title:   'Welcome! Your Onboarding Checklist is Ready',
    message: 'Please complete the onboarding tasks assigned to you.',
    type:    'onboarding',
    organization_id: oId,
  }).then(() => {});

  res.json(inserted);
});

// POST /api/onboarding
router.post('/', auth, hasPermission('onboarding', 'manage'), async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const oId = req.user.organization_id;
    const { user_id, title, description, due_date, assigned_to, order_index } = req.body;
    const { data, error } = await db.from('onboarding_checklists')
      .insert({ user_id, title, description: description || '', due_date: due_date || null, assigned_to: assigned_to || 'employee', order_index: order_index || 99, organization_id: oId })
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/onboarding/:id/complete
// Admins can complete any task; employees can only complete their own 'employee'-assigned tasks.
router.put('/:id/complete', auth, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { completed } = req.body;

    // Always fetch the task first so we can enforce ownership
    const { data: task, error: fetchErr } = await db
      .from('onboarding_checklists')
      .select('user_id, assigned_to')
      .eq('id', req.params.id)
      .eq('organization_id', oId)
      .single();

    if (fetchErr || !task) return res.status(404).json({ error: 'Task not found' });

    // Employees: must own the task AND it must be assigned to 'employee'
    if (!isAdmin(req.user.role)) {
      if (task.user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });
      if (task.assigned_to !== 'employee') return res.status(403).json({ error: 'Only HR or manager can complete this task' });
    }

    const { data, error } = await db.from('onboarding_checklists')
      .update({ completed: !!completed, completed_at: completed ? new Date().toISOString() : null })
      .eq('id', req.params.id).eq('organization_id', oId).select().single();
    if (error) throw error;
    res.json(data);

    // Fire-and-forget: notify next task assignee when a task is completed
    if (completed) {
      try {
        const { data: nextTask } = await db
          .from('onboarding_checklists')
          .select('id, title, assigned_to')
          .eq('user_id', task.user_id).eq('organization_id', oId)
          .eq('completed', false)
          .order('order_index').limit(1).maybeSingle();

        if (nextTask) {
          if (nextTask.assigned_to === 'employee') {
            // Notify the employee their next task is ready
            db.from('notifications').insert({
              user_id: task.user_id, title: 'Onboarding: Next Step Ready',
              message: `"${nextTask.title}" is your next onboarding task.`,
              type: 'onboarding', organization_id: oId,
            }).then(() => {});
          } else {
            // Notify HR admins that an HR/IT/manager onboarding task needs attention
            const { data: admins } = await db.from('users')
              .select('id').in('role', ['admin', 'root_admin']).eq('organization_id', oId);
            if (admins?.length) {
              db.from('notifications').insert(
                admins.map(a => ({
                  user_id: a.id, title: 'Onboarding Task Ready',
                  message: `Onboarding: "${nextTask.title}" requires ${nextTask.assigned_to} action.`,
                  type: 'onboarding', organization_id: oId,
                }))
              ).then(() => {});
            }
          }
        }
      } catch (_) {}
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/onboarding/:id
router.delete('/:id', auth, hasPermission('onboarding', 'manage'), async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const oId = req.user.organization_id;
    const { error } = await db.from('onboarding_checklists').delete().eq('id', req.params.id).eq('organization_id', oId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
