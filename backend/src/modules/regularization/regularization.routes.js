const express = require('express');
const router  = express.Router();
const { db, pool } = require('../../config/db');
const { auth } = require('../../middleware/auth');
const { hasPermission } = require('../../middleware/permissions');
const { generateEmployeePayslip } = require('../../services/payrollGenerationService');
const { withBranchContext } = require('../../middleware/branchContext');
const { resolveEmployeeIds, canAdminAccessUser } = require('../../utils/branchFilter');

function isAdmin(role) { return role === 'admin' || role === 'root_admin'; }

// GET /api/regularization
router.get('/', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const uid = req.user.id;
    let q = db.from('attendance_regularization')
      .select('*')
      .eq('organization_id', oId)
      .order('created_at', { ascending: false });
    if (!isAdmin(req.user.role)) {
      // Employees see only their own regularization requests — no branch filter needed
      q = q.eq('user_id', uid);
    } else {
      // Admin view — apply branch filter
      const empIds = await resolveEmployeeIds(req.branchContext, oId);
      if (empIds !== null && empIds.length === 0) return res.json([]);
      if (empIds !== null) q = q.in('user_id', empIds);
    }
    const { data, error } = await q;
    if (error) throw error;

    const rows = data || [];
    if (rows.length === 0) return res.json([]);

    // Fetch user names separately
    const userIds     = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
    const reviewerIds = [...new Set(rows.map(r => r.reviewed_by).filter(Boolean))];
    const allIds      = [...new Set([...userIds, ...reviewerIds])];

    const { data: users } = await db.from('users')
      .select('id, name, avatar_color, department, position')
      .in('id', allIds);
    const userMap = {};
    (users || []).forEach(u => { userMap[u.id] = u; });

    res.json(rows.map(r => ({
      ...r,
      user_name:          userMap[r.user_id]?.name || '',
      user_avatar_color:  userMap[r.user_id]?.avatar_color || '',
      user_department:    userMap[r.user_id]?.department || '',
      user_position:      userMap[r.user_id]?.position || '',
      reviewer_name:      userMap[r.reviewed_by]?.name || '',
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/regularization/usage — monthly combined early-leave + late count for employee
// Must be defined before /:id routes so 'usage' is not treated as an ID.
router.get('/usage', auth, async (req, res) => {
  try {
    const oId   = req.user.organization_id;
    const uid   = req.user.id;
    const now   = new Date();
    const month = parseInt(req.query.month) || (now.getMonth() + 1);
    const year  = parseInt(req.query.year)  || now.getFullYear();
    const pad   = n => String(n).padStart(2, '0');
    const start = `${year}-${pad(month)}-01`;
    const daysInMonth = new Date(year, month, 0).getDate();
    const end   = `${year}-${pad(month)}-${pad(daysInMonth)}`;

    // Count biometric-detected early_leave days and late-arriving days this month
    const attRes = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'early_leave')                   AS early_leave_days,
         COUNT(*) FILTER (WHERE is_late = TRUE AND status = 'present')    AS late_days
       FROM attendance
       WHERE user_id = $1 AND organization_id = $2 AND date >= $3 AND date <= $4`,
      [uid, oId, start, end]
    );
    const early_leave_days = parseInt(attRes.rows[0]?.early_leave_days || 0);
    const late_days        = parseInt(attRes.rows[0]?.late_days        || 0);
    const combined_count   = early_leave_days + late_days;

    // Fetch max allowance from work_schedule
    const schedRes = await pool.query(
      `SELECT COALESCE(max_early_leave_count, 3) AS max_allowance
         FROM work_schedule WHERE organization_id = $1 LIMIT 1`,
      [oId]
    );
    const max_allowance = parseInt(schedRes.rows[0]?.max_allowance || 3);

    // Approved early leave requests this month (for display)
    const elRes = await pool.query(
      `SELECT id, date, requested_early_exit_time, reason, status, created_at
         FROM attendance_regularization
        WHERE user_id = $1 AND organization_id = $2
          AND type = 'early_leave'
          AND date >= $3 AND date <= $4
        ORDER BY date DESC`,
      [uid, oId, start, end]
    );

    res.json({
      month, year,
      early_leave_days,
      late_days,          // informational only — late coming has its own independent quota
      combined_count,     // kept for reference; not used for early-leave quota decisions
      max_allowance,
      remaining: Math.max(0, max_allowance - early_leave_days),
      exhausted: early_leave_days >= max_allowance,
      early_leave_requests: elRes.rows,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/regularization
router.post('/', auth, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { date, requested_check_in, requested_check_out, reason,
            type = 'check_time', requested_early_exit_time } = req.body;
    if (!date || !reason) return res.status(400).json({ error: 'date and reason are required' });
    if (!['check_time', 'early_leave'].includes(type))
      return res.status(400).json({ error: 'Invalid request type' });
    if (type === 'early_leave' && !requested_early_exit_time)
      return res.status(400).json({ error: 'requested_early_exit_time is required for early leave requests' });

    const { data, error } = await db.from('attendance_regularization')
      .insert({
        user_id: req.user.id,
        date,
        type,
        requested_check_in:        type === 'check_time' ? (requested_check_in  || null) : null,
        requested_check_out:       type === 'check_time' ? (requested_check_out || null) : null,
        requested_early_exit_time: type === 'early_leave' ? (requested_early_exit_time || null) : null,
        reason,
        organization_id: oId,
      })
      .select().single();

    if (error) {
      if (error.code === '23505' || (error.message && error.message.includes('unique constraint'))) {
        const label = type === 'early_leave' ? 'early leave' : 'attendance correction';
        return res.status(409).json({ error: `You already have a pending ${label} request for this date.` });
      }
      throw error;
    }

    // Notify admins
    const { data: admins } = await db.from('users')
      .select('id').eq('organization_id', oId).in('role', ['admin', 'root_admin']);
    if (admins?.length) {
      const title   = type === 'early_leave' ? 'Early Leave Request' : 'Regularization Request';
      const message = type === 'early_leave'
        ? `${req.user.name} requested early leave on ${date} (exit at ${requested_early_exit_time})`
        : `${req.user.name} requested attendance correction for ${date}`;
      await db.from('notifications').insert(admins.map(a => ({
        user_id: a.id, title, message,
        type: 'regularization',
        reference_id: data.id, reference_type: 'regularization',
        organization_id: oId,
      })));
    }
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/regularization/:id/review
router.put('/:id/review', auth, hasPermission('attendance', 'approve_regularization'), withBranchContext, async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const oId = req.user.organization_id;
  const { status, reviewer_notes } = req.body;
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

  // All writes inside a single transaction with SELECT FOR UPDATE to prevent
  // concurrent double-approval of the same regularization request.
  const client = await pool.connect();
  let finalReg;
  try {
    await client.query('BEGIN');

    // Lock the row — any concurrent review of the same request blocks until COMMIT/ROLLBACK
    const lockRes = await client.query(
      `SELECT * FROM attendance_regularization
       WHERE id = $1 AND organization_id = $2
       FOR UPDATE`,
      [req.params.id, oId]
    );
    if (!lockRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found' });
    }
    const reg = lockRes.rows[0];

    // Branch isolation: admin must have access to this employee's branch.
    if (req.user.role !== 'root_admin') {
      if (!await canAdminAccessUser(req.branchContext, reg.user_id, oId)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
      }
    }

    // Idempotency guard — prevent double-approval
    if (reg.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Request already ${reg.status}. No changes made.`,
        current_status: reg.status,
      });
    }

    // 1. Update regularization status
    const reviewedAt = new Date().toISOString();
    const updRes = await client.query(
      `UPDATE attendance_regularization
       SET status = $1, reviewer_notes = $2, reviewed_by = $3, reviewed_at = $4
       WHERE id = $5
       RETURNING *`,
      [status, reviewer_notes || '', req.user.id, reviewedAt, req.params.id]
    );
    finalReg = updRes.rows[0];

    if (status === 'approved') {
      if (reg.type === 'early_leave') {
        // Auto-checkout the employee only if:
        //   1. The early leave is for today
        //   2. The approved exit time has already passed (current IST time >= exit time)
        //   3. The employee is currently checked in but not yet checked out
        // This prevents pre-setting checkout times before the employee actually leaves.
        if (reg.requested_early_exit_time && reg.date === new Date().toISOString().split('T')[0]) {
          const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
          }).formatToParts(new Date());
          const nowIST = `${parts.find(p => p.type === 'hour').value.padStart(2,'0')}:${parts.find(p => p.type === 'minute').value.padStart(2,'0')}`;
          const [nowH, nowM] = nowIST.split(':').map(Number);
          const [exitH, exitM] = reg.requested_early_exit_time.split(':').map(Number);
          const nowMins  = nowH * 60 + nowM;
          const exitMins = exitH * 60 + exitM;

          if (nowMins >= exitMins) {
            const attRes2 = await client.query(
              `SELECT * FROM attendance WHERE user_id = $1 AND date = $2 AND organization_id = $3`,
              [reg.user_id, reg.date, oId]
            );
            const existingAtt2 = attRes2.rows[0] || null;

            if (existingAtt2 && existingAtt2.check_in && !existingAtt2.check_out) {
              const exitTime = reg.requested_early_exit_time;
              const [h1, m1] = existingAtt2.check_in.split(':').map(Number);
              const totalMins = exitMins - (h1 * 60 + m1);
              if (totalMins > 0) {
                const breakMins = existingAtt2.total_break_minutes || 0;
                const effectiveMins = Math.max(0, totalMins - breakMins);
                const grossHours = Math.round((totalMins / 60) * 100) / 100;
                const workHours  = Math.round((effectiveMins / 60) * 100) / 100;
                await client.query(
                  `UPDATE attendance
                   SET check_out = $1, gross_hours = $2, work_hours = $3, status = 'early_leave', is_early_exit = TRUE
                   WHERE user_id = $4 AND date = $5 AND organization_id = $6`,
                  [exitTime, grossHours, workHours, reg.user_id, reg.date, oId]
                );
              }
            }
          }
        }
      } else {
        // check_time: apply the corrected attendance times
        // 2. Fetch existing attendance (inside transaction so we see latest state)
        const attRes = await client.query(
          `SELECT * FROM attendance
           WHERE user_id = $1 AND date = $2 AND organization_id = $3`,
          [reg.user_id, reg.date, oId]
        );
        const existingAtt = attRes.rows[0] || null;

        const final_check_in  = reg.requested_check_in  || existingAtt?.check_in  || null;
        const final_check_out = reg.requested_check_out || existingAtt?.check_out || null;

        let gross_hours = existingAtt?.gross_hours || 0;
        let work_hours  = existingAtt?.work_hours  || 0;
        if (final_check_in && final_check_out) {
          const [h1, m1] = final_check_in.split(':').map(Number);
          const [h2, m2] = final_check_out.split(':').map(Number);
          const totalMins     = (h2 * 60 + m2) - (h1 * 60 + m1);
          const breakMins     = existingAtt?.total_break_minutes || 0;
          const effectiveMins = Math.max(0, totalMins - breakMins);
          gross_hours = totalMins    > 0 ? Math.round((totalMins    / 60) * 100) / 100 : 0;
          work_hours  = effectiveMins > 0 ? Math.round((effectiveMins / 60) * 100) / 100 : 0;
        }

        // 3. Upsert attendance record
        if (existingAtt) {
          await client.query(
            `UPDATE attendance
             SET check_in = $1, check_out = $2, work_hours = $3, gross_hours = $4, status = 'present'
             WHERE user_id = $5 AND date = $6 AND organization_id = $7`,
            [final_check_in, final_check_out, work_hours, gross_hours, reg.user_id, reg.date, oId]
          );
        } else {
          await client.query(
            `INSERT INTO attendance (user_id, date, check_in, check_out, work_hours, gross_hours, status, organization_id)
             VALUES ($1,$2,$3,$4,$5,$6,'present',$7)
             ON CONFLICT (user_id, date, organization_id) DO UPDATE
               SET check_in = EXCLUDED.check_in, check_out = EXCLUDED.check_out,
                   work_hours = EXCLUDED.work_hours, gross_hours = EXCLUDED.gross_hours, status = 'present'`,
            [reg.user_id, reg.date, final_check_in, final_check_out, work_hours, gross_hours, oId]
          );
        }

        // 4. Cancel any approved leaves overlapping this date
        await client.query(
          `UPDATE leaves SET status = 'cancelled'
           WHERE user_id = $1 AND organization_id = $2 AND status = 'approved'
             AND start_date <= $3 AND end_date >= $3`,
          [reg.user_id, oId, reg.date]
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'Review failed — no changes saved. ' + err.message });
  } finally {
    client.release();
  }

  // Fire-and-forget: notification
  const isEarlyLeave = finalReg.type === 'early_leave';
  db.from('notifications').insert({
    user_id: finalReg.user_id,
    title:   isEarlyLeave
      ? `Early Leave Request ${status === 'approved' ? 'Approved' : 'Rejected'}`
      : `Regularization ${status === 'approved' ? 'Approved' : 'Rejected'}`,
    message: isEarlyLeave
      ? `Your early leave request for ${finalReg.date} was ${status}.${reviewer_notes ? ` Note: ${reviewer_notes}` : ''}`
      : `Your attendance correction for ${finalReg.date} was ${status}.${reviewer_notes ? ` Note: ${reviewer_notes}` : ''}`,
    type:    'regularization',
    organization_id: oId,
  }).then(() => {});

  // Fire-and-forget: regenerate draft payslip only for check_time approvals
  // (early_leave approvals do not change attendance records so payslip output is unchanged).
  if (status === 'approved' && !isEarlyLeave) {
    const regDate = new Date(finalReg.date + 'T12:00:00Z');
    const regMonth = regDate.getUTCMonth() + 1;
    const regYear  = regDate.getUTCFullYear();
    (async () => {
      try {
        const { rows: ps } = await pool.query(
          `SELECT id FROM payslips
            WHERE user_id         = $1
              AND month           = $2
              AND year            = $3
              AND organization_id = $4
              AND locked          = FALSE
            LIMIT 1`,
          [finalReg.user_id, regMonth, regYear, oId]
        );
        if (ps.length) {
          await generateEmployeePayslip(oId, finalReg.user_id, regMonth, regYear, req.user.id);
          console.log(`[Regularization] Regenerated draft payslip for user ${finalReg.user_id} ${regMonth}/${regYear} after attendance correction`);
        }
      } catch (e) {
        console.error('[Regularization] Post-approval payslip regen error:', e.message);
      }
    })();
  }

  res.json(finalReg);
});

// DELETE /api/regularization/:id — root_admin or admin can delete pending; root_admin can delete any
router.delete('/:id', auth, withBranchContext, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const oId = req.user.organization_id;

    const { data: reg } = await db.from('attendance_regularization')
      .select('id, status, user_id').eq('id', req.params.id).eq('organization_id', oId).maybeSingle();
    if (!reg) return res.status(404).json({ error: 'Request not found' });

    // Branch isolation: admin must have access to this employee's branch.
    if (req.user.role !== 'root_admin') {
      if (!await canAdminAccessUser(req.branchContext, reg.user_id, oId))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
    }

    // HR admin can only delete pending; root admin can delete any
    if (req.user.role === 'admin' && reg.status !== 'pending') {
      return res.status(403).json({ error: 'HR admin can only delete pending requests' });
    }

    const { error } = await db.from('attendance_regularization')
      .delete().eq('id', req.params.id).eq('organization_id', oId);
    if (error) throw error;

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
