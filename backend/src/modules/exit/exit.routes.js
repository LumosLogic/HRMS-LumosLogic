const express = require('express');
const router  = express.Router();
const { sameId } = require('../../utils/ids');
const { db, pool } = require('../../config/db');
const { auth } = require('../../middleware/auth');
const { hasPermission } = require('../../middleware/permissions');
const { initOffboarding } = require('../offboarding/offboardingService');
const lifecycle = require('../../services/employeeLifecycle');
const engine = require('../../services/leaveWorkflowEngine');
const { resolvePermissions, hasPermissionCheck } = require('../../services/permissionService');
const { withBranchContext } = require('../../middleware/branchContext');
const { resolveEmployeeIds, getAdminsForEmployee, canAdminAccessUser } = require('../../utils/branchFilter');

function isAdmin(role) { return role === 'admin' || role === 'root_admin'; }

// GET /api/exit
router.get('/', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { userId } = req.query;
    let q = db.from('exit_requests').select('*').eq('organization_id', oId).order('created_at', { ascending: false });

    if (!isAdmin(req.user.role)) {
      // Employees see only their own exit request — branch filter does not apply
      q = q.eq('user_id', req.user.id);
    } else if (userId) {
      // Admin requested a specific employee — keep as-is; org scope already enforced above
      q = q.eq('user_id', parseInt(userId));
    } else {
      // Admin viewing all — apply branch filter
      const empIds = await resolveEmployeeIds(req.branchContext, oId);
      if (empIds !== null && empIds.length === 0) return res.json([]);
      if (empIds !== null) q = q.in('user_id', empIds);
    }
    const { data, error } = await q;
    if (error) throw error;

    const rows = data || [];
    if (rows.length === 0) return res.json([]);

    const allIds = [...new Set([...rows.map(r => r.user_id), ...rows.map(r => r.reviewed_by)].filter(Boolean))];
    const { data: users } = await db.from('users').select('id, name, avatar_color, department, position').in('id', allIds);
    const uMap = {};
    (users || []).forEach(u => { uMap[u.id] = u; });

    res.json(rows.map(r => ({
      ...r,
      user_name:         uMap[r.user_id]?.name || '',
      user_avatar_color: uMap[r.user_id]?.avatar_color || '',
      user_department:   uMap[r.user_id]?.department || '',
      reviewer_name:     uMap[r.reviewed_by]?.name || '',
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/exit
// Employees submit their own resignation; admins can submit on behalf of any employee
// within the SAME organization only.
router.post('/', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { resignation_date: rd, reason, notice_period_days, user_id, exit_type: rawType } = req.body;
    const exitType = rawType === 'termination' ? 'termination' : 'resignation';
    // For a termination the date is the effective date (defaults to today); a resignation always needs its date.
    const resignation_date = rd || (exitType === 'termination' ? new Date().toISOString().split('T')[0] : null);
    if (!resignation_date) return res.status(400).json({ error: 'resignation_date is required' });
    if (exitType === 'termination') {
      // Termination is HR/Root-initiated only: needs exit.manage, an explicit target, never oneself.
      if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Only HR/Root can terminate an employee.' });
      if (req.user.role !== 'root_admin') {
        const perms = await resolvePermissions(req.user.id, oId);
        if (!hasPermissionCheck(perms, 'exit', 'manage')) return res.status(403).json({ error: "You don't have permission to perform this action", required_permission: 'exit.manage' });
      }
      if (!user_id) return res.status(400).json({ error: 'user_id is required for a termination' });
      if (sameId(user_id, req.user.id)) return res.status(400).json({ error: 'You cannot terminate yourself.' });
    }

    // Employees always submit for themselves; admins may specify a target employee.
    let targetUserId = req.user.id;
    let targetName   = req.user.name;

    if (isAdmin(req.user.role) && user_id) {
      // Validate that the target user belongs to this org — prevents cross-org IDOR.
      const { data: targetUser } = await db.from('users')
        .select('id, name').eq('id', parseInt(user_id)).eq('organization_id', oId).maybeSingle();
      if (!targetUser) return res.status(400).json({ error: 'Employee not found in your organization.' });
      if (!sameId(targetUser.id, req.user.id) && !await canAdminAccessUser(req.branchContext, targetUser.id, oId))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
      targetUserId = targetUser.id;
      targetName   = targetUser.name;
      if (exitType === 'termination') {
        const { data: tr } = await db.from('users').select('role').eq('id', targetUser.id).maybeSingle();
        if (tr?.role !== 'employee' && req.user.role !== 'root_admin')
          return res.status(403).json({ error: 'Only root admins can terminate HR/admin accounts.' });
      }
    }

    // Prevent a duplicate open resignation for the same employee.
    const { data: existing } = await db.from('exit_requests')
      .select('id, status').eq('user_id', targetUserId).eq('organization_id', oId)
      .in('status', ['pending', 'approved']).maybeSingle();
    if (existing) return res.status(400).json({ error: 'An active resignation request already exists for this employee.' });

    const noticeDays = exitType === 'termination' ? (Number(notice_period_days) || 0) : (Number(notice_period_days) || 30);
    const rDate = new Date(resignation_date);
    const lwd   = new Date(rDate);
    lwd.setDate(lwd.getDate() + noticeDays);

    const { data, error } = await db.from('exit_requests')
      .insert({
        user_id: targetUserId, resignation_date,
        reason: reason || '', notice_period_days: noticeDays,
        last_working_day: lwd.toISOString().split('T')[0],
        organization_id: oId,
        exit_type: exitType,
        ...(exitType === 'termination' && { status: 'approved', reviewed_by: req.user.id, reviewed_at: new Date().toISOString() }),
      })
      .select().single();
    if (error) throw error;

    if (exitType === 'termination') {
      // Same effect as approving: status flips (access revoked immediately), offboarding checklist is created.
      const { rows: pr } = await pool.query('SELECT employee_status FROM users WHERE id = $1 AND organization_id = $2', [targetUserId, oId]);
      await db.from('users').update({ employee_status: 'terminated', status: lifecycle.legacyStatusFor('terminated') })
        .eq('id', targetUserId).eq('organization_id', oId);
      await lifecycle.afterStatusChange({ orgId: oId, userId: targetUserId, prev: pr[0]?.employee_status || 'active', next: 'terminated', actorId: req.user.id });
      await initOffboarding(targetUserId, oId);
      const adminIds = (await getAdminsForEmployee(targetUserId, oId)).filter(id => !sameId(id, req.user.id));
      if (adminIds.length) {
        await db.from('notifications').insert(adminIds.map(id => ({
          user_id: id, title: 'Employee Terminated — Action Required',
          message: `${targetName} was terminated (effective ${lwd.toISOString().split('T')[0]}). Please complete: IT access revocation, asset return, and final settlement.`,
          type: 'exit', organization_id: oId, subject_user_id: targetUserId,
        })));
      }
      return res.json(data);
    }

    // Notify only branch-scoped HR admins and root admins
    const adminIds = await getAdminsForEmployee(targetUserId, oId);
    if (adminIds.length) {
      await db.from('notifications').insert(adminIds.map(id => ({
        user_id: id, title: 'Resignation Submitted',
        message: `${targetName} submitted a resignation. Last working day: ${lwd.toISOString().split('T')[0]}`,
        type: 'exit', organization_id: oId, subject_user_id: targetUserId,
      })));
    }

    // Notify the employee's department head — they need to plan for the departure (fire-and-forget)
    ;(async () => {
      try {
        const { userId: dhId } = await engine.resolveApprover({ role_type: 'department_head' }, targetUserId, oId);
        if (!dhId || sameId(dhId, targetUserId)) return;
        await db.from('notifications').insert({
          user_id: dhId, title: 'Team Member Resignation',
          message: `${targetName} has submitted a resignation. Last working day: ${lwd.toISOString().split('T')[0]}. Please plan for handover.`,
          type: 'exit', organization_id: oId,
        });
      } catch {}
    })();

    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/exit/:id — fetch a single exit request (for modal detail view)
router.get('/:id', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { data, error } = await db.from('exit_requests')
      .select('*').eq('id', req.params.id).eq('organization_id', oId).single();
    if (error) return res.status(404).json({ error: 'Exit request not found' });
    if (!isAdmin(req.user.role) && !sameId(data.user_id, req.user.id))
      return res.status(403).json({ error: 'Access denied' });
    if (isAdmin(req.user.role) && !sameId(data.user_id, req.user.id) && !await canAdminAccessUser(req.branchContext, data.user_id, oId))
      return res.status(403).json({ error: "You do not have access to this employee's branch." });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/exit/:id
router.put('/:id', auth, hasPermission('exit', 'manage'), withBranchContext, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const oId = req.user.organization_id;
    {
      const { data: tgt } = await db.from('exit_requests').select('user_id').eq('id', req.params.id).eq('organization_id', oId).maybeSingle();
      if (!tgt) return res.status(404).json({ error: 'Exit request not found' });
      if (!sameId(tgt.user_id, req.user.id) && !await canAdminAccessUser(req.branchContext, tgt.user_id, oId))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
    }
    // Explicit field whitelist — prevents mass assignment of user_id, reviewed_by, reviewed_at, etc.
    const { resignation_date, reason, notice_period_days, last_working_day, notes, status,
            clearance_it, clearance_hr, clearance_finance, clearance_admin,
            rehire_eligible, rejection_reason } = req.body;
    const updates = {};
    if (resignation_date   !== undefined) updates.resignation_date   = resignation_date;
    if (reason             !== undefined) updates.reason             = reason || '';
    if (notice_period_days !== undefined) updates.notice_period_days = Number(notice_period_days) || 30;
    if (last_working_day   !== undefined) updates.last_working_day   = last_working_day;
    if (notes              !== undefined) updates.notes              = notes || '';
    // BUG_155: clearance fields must be included in the whitelist
    if (clearance_it      !== undefined) updates.clearance_it      = !!clearance_it;
    if (clearance_hr      !== undefined) updates.clearance_hr      = !!clearance_hr;
    if (clearance_finance !== undefined) updates.clearance_finance = !!clearance_finance;
    if (clearance_admin   !== undefined) updates.clearance_admin   = !!clearance_admin;
    // BUG_043: rehire eligibility + rejection reason must be persisted (previously dropped)
    if (rehire_eligible  !== undefined) updates.rehire_eligible  = rehire_eligible;
    if (rejection_reason !== undefined) updates.rejection_reason = rejection_reason || '';
    if (status             !== undefined) {
      if (!['approved', 'rejected', 'completed'].includes(status))
        return res.status(400).json({ error: "status must be 'approved', 'rejected', or 'completed'" });
      updates.status = status;
    }
    const isStatusChange = ['approved', 'rejected', 'completed'].includes(updates.status);

    // Guard against empty update object (would cause a DB error)
    if (Object.keys(updates).length === 0) {
      const { data: current } = await db.from('exit_requests').select('*').eq('id', req.params.id).eq('organization_id', oId).single();
      return res.json(current || {});
    }

    let current = null;   // read again after the update (approval side-effects) — must outlive this block
    if (isStatusChange) {
      // Fetch current state to enforce idempotency — prevent double-approval
      ({ data: current } = await db.from('exit_requests')
        .select('*').eq('id', req.params.id).eq('organization_id', oId).single());
      if (!current) return res.status(404).json({ error: 'Exit request not found' });
      if (current.status === updates.status) {
        // Already in the target status — return current record idempotently
        const { data: existing } = await db.from('exit_requests').select('*').eq('id', req.params.id).single();
        return res.json(existing);
      }
      // Enforce valid state transitions for exit requests:
      //   pending  → approved | rejected
      //   approved → completed
      const allowedTransitions = {
        pending:   ['approved', 'rejected'],
        approved:  ['completed'],
        rejected:  [],
        completed: [],
      };
      const allowed = allowedTransitions[current.status] || [];
      if (!allowed.includes(updates.status)) {
        const friendlyMessages = {
          completed: {
            rejected:  'This exit request was already rejected and cannot be completed. Please raise a new exit request if needed.',
            completed: 'This offboarding has already been marked as completed.',
            pending:   'The exit request must be approved before it can be marked as completed. Please approve the request first.',
          },
          approved: {
            completed: 'This offboarding has already been marked as completed. No further changes are possible.',
            rejected:  'This exit request was already rejected.',
          },
          rejected: {
            pending:   'You cannot reject an exit request that is still pending — please approve or reject it first.',
          },
        };
        const msg = friendlyMessages[updates.status]?.[current.status]
          || `Cannot change status from "${current.status}" to "${updates.status}". The exit request must be in the correct state for this action.`;
        return res.status(409).json({ error: msg, current_status: current.status });
      }
      updates.reviewed_by = req.user.id;
      updates.reviewed_at = new Date().toISOString();
    }

    const { data, error } = await db.from('exit_requests')
      .update(updates).eq('id', req.params.id).eq('organization_id', oId).select().single();
    if (error) throw error;

    // Fire-and-forget side effects after successful update
    if (isStatusChange) {
      // Notify the employee
      db.from('notifications').insert({
        user_id: data.user_id,
        title:   updates.status === 'approved' ? 'Exit Request Accepted' : updates.status === 'completed' ? 'Offboarding Complete' : 'Exit Request Reviewed',
        message: updates.status === 'completed' ? 'Your offboarding process has been completed.' : `Your resignation has been ${updates.status}.`,
        type:    'exit', organization_id: oId,
      }).then(() => {});

      // On approval: mark employee as resigned (notice period active, not yet blocked).
      // A daily cron will transition resigned→inactive once last_working_day passes.
      if (updates.status === 'approved') {
        // BUG_218: await this update so the status change is guaranteed before responding.
        // exit_type decides the resulting status; everything else (legacy status, session, checklist) is shared.
        const nextStatus = current.exit_type === 'termination' ? 'terminated' : 'resigned';
        const { rows: pr } = await pool.query('SELECT employee_status FROM users WHERE id = $1 AND organization_id = $2', [current.user_id, oId]);
        await db.from('users')
          .update({ employee_status: nextStatus, status: lifecycle.legacyStatusFor(nextStatus) })
          .eq('id', current.user_id)
          .eq('organization_id', oId);
        await lifecycle.afterStatusChange({ orgId: oId, userId: current.user_id, prev: pr[0]?.employee_status || 'active', next: nextStatus, actorId: req.user.id });

        // Notify branch-scoped admins of the approved exit — rewritten to avoid messy chaining
        ;(async () => {
          try {
            const [empRes, adminIds] = await Promise.all([
              db.from('users').select('name').eq('id', current.user_id).maybeSingle(),
              getAdminsForEmployee(current.user_id, oId),
            ]);
            const empName = empRes.data?.name || 'An employee';
            if (!adminIds.length) return;
            await db.from('notifications').insert(
              adminIds.map(id => ({
                user_id: id,
                title:   'Exit Approved — Action Required',
                message: `${empName}'s resignation is approved (LWD: ${data.last_working_day || 'TBD'}). Please complete: IT access revocation, asset return, and final settlement.`,
                type:    'exit',
                organization_id: oId,
                subject_user_id: current.user_id,
              }))
            );
          } catch { /* fire-and-forget */ }
        })();

        // Trigger offboarding checklist — idempotent; table guaranteed by startup migration
        initOffboarding(current.user_id, oId).catch(e =>
          console.error('[exit] initOffboarding failed:', e.message)
        );
      }
    }
    res.json(data);
  } catch (err) {
    // BUG_043: log the real error server-side so schema issues are diagnosable,
    // but keep the client-facing message clear and user-friendly.
    console.error('[exit] update error:', err.message);
    const safe = /column|relation|does not exist|syntax error/i.test(err.message)
      ? 'We could not save your changes due to a system configuration issue. Please try again, or contact support if the problem persists.'
      : (err.message || 'Server error');
    res.status(500).json({ error: safe });
  }
});

// DELETE /api/exit/:id — employee can withdraw their own pending resignation; admin can delete any pending.
router.delete('/:id', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { data: req_ } = await db.from('exit_requests')
      .select('id, user_id, status').eq('id', req.params.id).eq('organization_id', oId).maybeSingle();
    if (!req_) return res.status(404).json({ error: 'Exit request not found' });

    // Only the employee who submitted it (or an admin) can withdraw
    if (!isAdmin(req.user.role) && !sameId(req_.user_id, req.user.id))
      return res.status(403).json({ error: 'Access denied' });
    if (isAdmin(req.user.role) && !sameId(req_.user_id, req.user.id) && !await canAdminAccessUser(req.branchContext, req_.user_id, oId))
      return res.status(403).json({ error: "You do not have access to this employee's branch." });

    // Only pending resignations can be withdrawn — approved exits require HR action
    if (req_.status !== 'pending')
      return res.status(400).json({ error: `Cannot withdraw a ${req_.status} resignation. Contact HR.` });

    const { error } = await db.from('exit_requests').delete().eq('id', req.params.id).eq('organization_id', oId);
    if (error) throw error;
    res.json({ ok: true, message: 'Resignation withdrawn successfully.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
