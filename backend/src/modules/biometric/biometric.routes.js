const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const { pool } = require('../../config/db-pg-adapter');
const { auth, adminOnly } = require('../../middleware/auth');
const { invalidateBiometricIpCache } = require('../../middleware/biometricIpGuard');
const { withBranchContext } = require('../../middleware/branchContext');
const { getFilterState, canAdminAccessUser } = require('../../utils/branchFilter');
const { scheduleSyncForSn } = require('./biometricHeartbeat.handler');
const { processAttlogLine } = require('./biometricPush.handler');
const biometricEmitter = require('../../utils/biometricEmitter');
const { reprocessPin, reprocessPinForDates } = require('./biometricReprocess.util');
const { importEasyWDMS, previewEasyWDMS } = require('./biometricEasyWDMSImport.handler');
const { getOrgPolicy }   = require('../../utils/orgPolicy');
const { activateJob, getActiveJobForSn } = require('./biometricHistoricalSync.handler');
const autoSyncScheduler = require('./biometricAutoSyncScheduler');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(xlsx|xls|csv|tsv|txt)$/i;
    cb(null, allowed.test(file.originalname));
  },
});

// ─── GET /api/biometric/devices ───────────────────────────────────────────────
router.get('/devices', auth, adminOnly, withBranchContext, async (req, res) => {
  try {
    const orgId = req.user.organization_id;
    const branchState = getFilterState(req.branchContext);

    // State D: no accessible branches → no devices
    if (branchState.type === 'none') return res.json([]);

    // Build optional branch WHERE clause using biometric_devices.branch_id directly.
    // Devices with NULL branch_id (unassigned) are excluded from specific/multi views —
    // they cannot be attributed to a branch until an admin assigns one.
    let branchClause = '';
    const params = [orgId];

    if (branchState.type === 'specific') {
      branchClause = `AND d.branch_id = $${params.length + 1}`;
      params.push(branchState.branchId);
    } else if (branchState.type === 'multi') {
      branchClause = `AND d.branch_id = ANY($${params.length + 1}::bigint[])`;
      params.push(branchState.branchIds);
    }
    // type === 'all': no additional filter — all org devices returned

    const result = await pool.query(
      `SELECT d.*, b.name AS branch_name
       FROM biometric_devices d
       LEFT JOIN branches b ON b.id = d.branch_id
       WHERE d.org_id = $1 ${branchClause}
       ORDER BY d.device_name`,
      params
    );
    const now = Date.now();
    const devices = result.rows.map(d => ({
      ...d,
      online: d.last_seen
        ? (now - new Date(d.last_seen).getTime()) < 5 * 60 * 1000
        : false,
    }));
    res.json(devices);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/biometric/devices ─────────────────────────────────────────────
router.post('/devices', auth, adminOnly, withBranchContext, async (req, res) => {
  try {
    const orgId = req.user.organization_id;
    const { device_name, serial_number, location, branch_id, area_code, device_ip } = req.body;
    if (!serial_number) return res.status(400).json({ error: 'serial_number is required' });

    // Branch isolation: non-root admin can only create a device in an accessible branch
    if (req.user.role !== 'root_admin' && branch_id) {
      const { validateBranchAccess } = require('../../services/branchService');
      const ok = await validateBranchAccess(req.user.id, orgId, req.user.role, parseInt(branch_id, 10));
      if (!ok) return res.status(403).json({ error: 'You do not have access to the specified branch.' });
    }

    const result = await pool.query(
      `INSERT INTO biometric_devices
         (org_id, serial_number, device_name, location, branch_id, area_code, device_ip, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'offline')
       RETURNING *`,
      [orgId, serial_number, device_name || null, location || null,
       branch_id || null, area_code || null, device_ip || null]
    );
    invalidateBiometricIpCache(); // new device IP must take effect immediately
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A device with this serial number already exists' });
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/biometric/devices/:id ──────────────────────────────────────────
router.put('/devices/:id', auth, adminOnly, withBranchContext, async (req, res) => {
  try {
    const orgId = req.user.organization_id;
    const { device_name, location, branch_id, area_code, device_ip } = req.body;

    // Branch isolation: load current device and verify admin can access its branch
    if (req.user.role !== 'root_admin') {
      const cur = await pool.query(
        `SELECT branch_id FROM biometric_devices WHERE id = $1 AND org_id = $2`,
        [req.params.id, orgId]
      );
      if (!cur.rows.length) return res.status(404).json({ error: 'Device not found' });
      const { getFilterState } = require('../../utils/branchFilter');
      const state = getFilterState(req.branchContext);
      const devBranch = cur.rows[0].branch_id;
      if (state.type === 'specific' && devBranch !== state.branchId)
        return res.status(403).json({ error: 'You do not have access to this device.' });
      if (state.type === 'multi' && devBranch && !state.branchIds.includes(devBranch))
        return res.status(403).json({ error: 'You do not have access to this device.' });
      if (state.type === 'none')
        return res.status(403).json({ error: 'You do not have access to this device.' });
    }

    const result = await pool.query(
      `UPDATE biometric_devices
       SET device_name = $1, location = $2, branch_id = $3, area_code = $4, device_ip = $5
       WHERE id = $6 AND org_id = $7
       RETURNING *`,
      [device_name || null, location || null, branch_id || null,
       area_code || null, device_ip || null, req.params.id, orgId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Device not found' });
    invalidateBiometricIpCache(); // IP change must take effect immediately
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── DELETE /api/biometric/devices/:id ───────────────────────────────────────
router.delete('/devices/:id', auth, adminOnly, withBranchContext, async (req, res) => {
  try {
    const orgId = req.user.organization_id;

    // Branch isolation: verify admin can access this device's branch before deleting
    if (req.user.role !== 'root_admin') {
      const cur = await pool.query(
        `SELECT branch_id FROM biometric_devices WHERE id = $1 AND org_id = $2`,
        [req.params.id, orgId]
      );
      if (!cur.rows.length) return res.status(404).json({ error: 'Device not found' });
      const { getFilterState } = require('../../utils/branchFilter');
      const state = getFilterState(req.branchContext);
      const devBranch = cur.rows[0].branch_id;
      if (state.type === 'specific' && devBranch !== state.branchId)
        return res.status(403).json({ error: 'You do not have access to this device.' });
      if (state.type === 'multi' && devBranch && !state.branchIds.includes(devBranch))
        return res.status(403).json({ error: 'You do not have access to this device.' });
      if (state.type === 'none')
        return res.status(403).json({ error: 'You do not have access to this device.' });
    }

    const result = await pool.query(
      `DELETE FROM biometric_devices WHERE id = $1 AND org_id = $2 RETURNING id, device_name`,
      [req.params.id, orgId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Device not found' });
    invalidateBiometricIpCache();
    res.json({ ok: true, deleted: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/biometric/live-logs ─────────────────────────────────────────────
router.get('/live-logs', auth, adminOnly, withBranchContext, async (req, res) => {
  const orgId = req.user.organization_id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Load allowed SNs — scoped to org and (if applicable) to accessible branches
  let allowedSns = new Set();
  try {
    const branchState = getFilterState(req.branchContext);
    let snQuery = `SELECT serial_number FROM biometric_devices WHERE org_id = $1`;
    const snParams = [orgId];
    if (branchState.type === 'specific') {
      snQuery += ` AND branch_id = $2`;
      snParams.push(branchState.branchId);
    } else if (branchState.type === 'multi') {
      snQuery += ` AND branch_id = ANY($2::bigint[])`;
      snParams.push(branchState.branchIds);
    } else if (branchState.type === 'none') {
      // No accessible branches — send nothing; close immediately
      res.end();
      return;
    }
    // type 'all' → no additional filter (all org devices)
    const devRes = await pool.query(snQuery, snParams);
    devRes.rows.forEach(d => { if (d.serial_number) allowedSns.add(d.serial_number); });
  } catch (err) {
    console.error('[biometric] SSE DB error:', err);
  }

  const logListener = (data) => {
    // Only send logs if they belong to this org's devices
    if (!data.sn || allowedSns.has(data.sn)) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  biometricEmitter.on('log', logListener);

  const keepAlive = setInterval(() => {
    res.write(':\n\n');
  }, 15000);

  req.on('close', () => {
    biometricEmitter.off('log', logListener);
    clearInterval(keepAlive);
  });
});

// ─── GET /api/biometric/logs ──────────────────────────────────────────────────
router.get('/logs', auth, adminOnly, withBranchContext, async (req, res) => {
  try {
    const orgId  = req.user.organization_id;
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(200, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;
    const branchState = getFilterState(req.branchContext);

    // State D: no accessible branches → empty result
    if (branchState.type === 'none') return res.json({ data: [], page, limit, total: 0 });

    // Build filter conditions with a shared params array (only filter values, no limit/offset)
    const filterParams = [orgId];
    let where = 'WHERE l.org_id = $1';
    let idx = 2;

    // Branch filter: use employee's branch (users.branch_id) as the authoritative branch.
    // Derived via: l.employee_pin → biometric_employee_map m → users u → u.branch_id.
    // The existing LEFT JOINs already resolve this path. For specific/multi branch views,
    // logs with no resolved employee (u IS NULL — unmapped PINs) are excluded because
    // their branch cannot be determined. They remain visible under All Branches (type=all).
    if (branchState.type === 'specific') {
      where += ` AND u.branch_id = $${idx++}`;
      filterParams.push(branchState.branchId);
    } else if (branchState.type === 'multi') {
      where += ` AND u.branch_id = ANY($${idx++}::bigint[])`;
      filterParams.push(branchState.branchIds);
    }
    // type === 'all': no branch clause — all org logs returned (including unmapped PINs)

    if (req.query.device_serial) {
      where += ` AND l.device_serial = $${idx++}`;
      filterParams.push(req.query.device_serial);
    }
    if (req.query.employee_pin) {
      where += ` AND l.employee_pin = $${idx++}`;
      filterParams.push(req.query.employee_pin);
    }
    if (req.query.name_search) {
      // Search by employee name (via joined users table) OR by employee_pin
      where += ` AND (u.name ILIKE $${idx} OR l.employee_pin ILIKE $${idx})`;
      filterParams.push(`%${req.query.name_search}%`);
      idx++;
    }
    if (req.query.user_id) {
      // Use subqueries so org_id join mismatches don't silently filter everything out.
      // Looks up pin from biometric_employee_map OR device_enrollment_id on users table.
      where += ` AND l.employee_pin IN (
        SELECT employee_pin FROM biometric_employee_map WHERE user_id = $${idx}
        UNION
        SELECT device_enrollment_id FROM users WHERE id = $${idx} AND device_enrollment_id IS NOT NULL
      )`;
      filterParams.push(parseInt(req.query.user_id));
      idx++;
    }
    if (req.query.processed !== undefined && req.query.processed !== '') {
      where += ` AND l.processed = $${idx++}`;
      filterParams.push(req.query.processed === 'true');
    }
    if (req.query.date_from) {
      where += ` AND l.punch_time >= $${idx++}`;
      filterParams.push(req.query.date_from);
    }
    if (req.query.date_to) {
      where += ` AND l.punch_time <= $${idx++}`;
      filterParams.push(req.query.date_to + ' 23:59:59');
    }

    const [result, countRes] = await Promise.all([
      pool.query(
        `SELECT l.*, u.name AS employee_name
         FROM biometric_raw_logs l
         LEFT JOIN biometric_employee_map m ON m.org_id = l.org_id AND m.employee_pin = l.employee_pin
         LEFT JOIN users u ON u.id = m.user_id
         ${where}
         ORDER BY l.punch_time DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...filterParams, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*)
         FROM biometric_raw_logs l
         LEFT JOIN biometric_employee_map m ON m.org_id = l.org_id AND m.employee_pin = l.employee_pin
         LEFT JOIN users u ON u.id = m.user_id
         ${where}`,
        filterParams
      ),
    ]);

    res.json({
      data: result.rows,
      page,
      limit,
      total: parseInt(countRes.rows[0].count, 10),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/biometric/employee-map ─────────────────────────────────────────
router.get('/employee-map', auth, adminOnly, withBranchContext, async (req, res) => {
  try {
    const orgId = req.user.organization_id;
    const branchState = getFilterState(req.branchContext);

    // State D: no accessible branches → empty
    if (branchState.type === 'none') return res.json([]);

    // Branch filter operates on the employee's branch (users.branch_id) —
    // authoritative organizational branch for employee-map visibility.
    // The existing JOIN to users u is used; no new JOIN required.
    const params = [orgId];
    let branchClause = '';

    if (branchState.type === 'specific') {
      branchClause = `AND u.branch_id = $${params.length + 1}`;
      params.push(branchState.branchId);
    } else if (branchState.type === 'multi') {
      branchClause = `AND u.branch_id = ANY($${params.length + 1}::bigint[])`;
      params.push(branchState.branchIds);
    }
    // type === 'all': no branch clause — all org mappings returned

    const result = await pool.query(
      `SELECT m.id, m.employee_pin, m.user_id, m.created_at,
              u.name AS employee_name, u.department, u.device_enrollment_id
       FROM biometric_employee_map m
       JOIN users u ON u.id = m.user_id
       WHERE m.org_id = $1 ${branchClause}
       ORDER BY m.employee_pin::int NULLS LAST`,
      params
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/biometric/employee-map ────────────────────────────────────────
router.post('/employee-map', auth, adminOnly, async (req, res) => {
  try {
    const orgId = req.user.organization_id;
    const { employee_pin, user_id } = req.body;
    if (!employee_pin || !user_id) {
      return res.status(400).json({ error: 'employee_pin and user_id are required' });
    }
    const result = await pool.query(
      `INSERT INTO biometric_employee_map (org_id, employee_pin, user_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [orgId, String(employee_pin), user_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This PIN is already mapped to an employee' });
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/biometric/employee-map/:id ──────────────────────────────────
router.delete('/employee-map/:id', auth, adminOnly, async (req, res) => {
  try {
    const orgId = req.user.organization_id;
    const result = await pool.query(
      `DELETE FROM biometric_employee_map WHERE id = $1 AND org_id = $2 RETURNING id`,
      [req.params.id, orgId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Mapping not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/biometric/devices/:id/force-sync ──────────────────────────────
// Requests the device to resend all stored historical attendance records.
// Schedules GET ATTLOG Stamp=0 for the device's next heartbeat (~60s).
// Records are received via the existing live PUSH pipeline with full duplicate
// protection — already-stored punches are silently skipped (ON CONFLICT DO NOTHING).
router.post('/devices/:id/force-sync', auth, adminOnly, async (req, res) => {
  try {
    const orgId = req.user.organization_id;
    const devRes = await pool.query(
      `SELECT serial_number, device_name FROM biometric_devices WHERE id = $1 AND org_id = $2`,
      [req.params.id, orgId]
    );
    if (!devRes.rows.length) return res.status(404).json({ error: 'Device not found' });
    const { serial_number, device_name } = devRes.rows[0];

    // Schedule GET ATTLOG Stamp=0 — full re-upload of all device-stored records
    scheduleSyncForSn(serial_number);

    // Record that a sync was requested so the UI can show "last sync: X ago"
    await pool.query(
      `UPDATE biometric_devices
       SET last_sync_requested_at = NOW(), last_sync_status = 'requested'
       WHERE id = $1 AND org_id = $2`,
      [req.params.id, orgId]
    );

    res.json({
      ok: true,
      message: `Historical sync requested for ${device_name} (${serial_number}). ` +
               `The device will resend all stored records on its next heartbeat (~30–60 s). ` +
               `Records already in HRMS will not be duplicated.`,
      sync_status: 'requested',
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/biometric/reprocess ───────────────────────────────────────────
router.post('/reprocess', auth, adminOnly, async (req, res) => {
  try {
    const orgId = req.user.organization_id;
    const { employee_pin } = req.body;
    if (!employee_pin) return res.status(400).json({ error: 'employee_pin is required' });

    const result = await reprocessPin(orgId, employee_pin);
    if (result.noMapping) return res.status(404).json({ error: 'No employee mapping found for this PIN' });
    res.json({ ok: true, processed: result.processed, total: result.total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/biometric/reprocess-all ───────────────────────────────────────
// Reprocesses every mapped employee PIN for this org using the org's attendance
// policy. Run once after enabling first_in_last_out to fix all historical data.
// Also useful after a bulk raw-log reset (UPDATE biometric_raw_logs SET processed=false).
router.post('/reprocess-all', auth, adminOnly, async (req, res) => {
  const orgId = req.user.organization_id;

  // Respond immediately — reprocessing can take a while
  res.json({ ok: true, message: 'Reprocess started in background. Check server logs for progress.' });

  setImmediate(async () => {
    try {
      const pinsRes = await pool.query(
        `SELECT DISTINCT employee_pin FROM biometric_raw_logs
         WHERE org_id = $1 AND processed = false
         ORDER BY employee_pin`,
        [orgId]
      );

      const pins = pinsRes.rows.map(r => r.employee_pin);
      console.log(`[reprocess-all] org=${orgId} starting reprocess for ${pins.length} PINs`);

      let totalProcessed = 0;
      let noMapping      = 0;
      let errors         = 0;

      for (const pin of pins) {
        try {
          const r = await reprocessPin(orgId, pin);
          if (r.noMapping) { noMapping++; continue; }
          totalProcessed += r.processed;
        } catch (err) {
          errors++;
          console.error(`[reprocess-all] PIN ${pin} error:`, err.message);
        }
      }

      console.log(
        `[reprocess-all] org=${orgId} done — ` +
        `pins=${pins.length} processed=${totalProcessed} no_mapping=${noMapping} errors=${errors}`
      );
    } catch (err) {
      console.error('[reprocess-all] Fatal error:', err.message);
    }
  });
});

// ─── POST /api/biometric/collector-push ──────────────────────────────────────
// Authenticated bulk-import from the EasyWDMS collector agent running on the
// client's Windows machine. Uses a static API key — no JWT (service account).
//
// Body: { device_serial: "BYEL194660080", punches: [{ employee_pin, punch_time, punch_type }] }
router.post('/collector-push', async (req, res) => {
  try {
    // ── API key auth ──────────────────────────────────────────────────────────
    const key = req.headers['x-collector-key'];
    if (!key || key !== process.env.BIOMETRIC_COLLECTOR_KEY) {
      return res.status(401).json({ error: 'Invalid or missing collector API key' });
    }
    if (!process.env.BIOMETRIC_COLLECTOR_KEY) {
      return res.status(503).json({ error: 'BIOMETRIC_COLLECTOR_KEY not configured on server' });
    }

    const { device_serial, punches } = req.body;
    if (!device_serial || typeof device_serial !== 'string')
      return res.status(400).json({ error: 'device_serial is required' });
    if (!Array.isArray(punches) || punches.length === 0)
      return res.status(400).json({ error: 'punches must be a non-empty array' });
    if (punches.length > 5000)
      return res.status(400).json({ error: 'Max 5000 punches per request' });

    // ── Look up device ────────────────────────────────────────────────────────
    const devRes = await pool.query(
      'SELECT id, org_id FROM biometric_devices WHERE serial_number = $1 LIMIT 1',
      [device_serial.trim()]
    );
    if (!devRes.rows.length)
      return res.status(404).json({ error: `Device ${device_serial} not registered in HRMS` });

    const { id: deviceId, org_id: orgId } = devRes.rows[0];

    // Mark device online
    await pool.query(
      `UPDATE biometric_devices SET last_seen = NOW(), status = 'online' WHERE id = $1`,
      [deviceId]
    );

    // Fetch org policy once — shared across all punches from this device
    const [policy, wsRow] = await Promise.all([
      getOrgPolicy(orgId),
      pool.query(`SELECT half_day_hours, end_time FROM work_schedule WHERE organization_id = $1 LIMIT 1`, [orgId]),
    ]);
    const halfDayHours = parseFloat(wsRow.rows[0]?.half_day_hours ?? 4.5);
    const shiftEndTime = wsRow.rows[0]?.end_time || '17:30';

    // ── Process each punch ────────────────────────────────────────────────────
    let imported = 0;
    let skipped  = 0;
    const errors = [];

    for (const punch of punches) {
      const { employee_pin, punch_time, punch_type } = punch;

      if (!employee_pin || !punch_time) { skipped++; continue; }

      const pt = new Date(punch_time);
      if (isNaN(pt.getTime())) { skipped++; continue; }

      // Hard cutoff: Strictly ignore any punches before August 1st, 2026 (Go-Live Date)
      if (pt < new Date('2026-08-01T00:00:00+05:30')) {
        skipped++;
        continue;
      }

      // Format as ATTLOG line (PIN\tTime\tType) — same format the device uses
      const punchTypeInt = parseInt(punch_type ?? 0, 10);
      const timeStr      = pt.toISOString().replace('T', ' ').slice(0, 19); // "YYYY-MM-DD HH:MM:SS"
      const attlogLine   = `${String(employee_pin).trim()}\t${timeStr}\t${punchTypeInt}`;

      try {
        await processAttlogLine(attlogLine, orgId, device_serial.trim(), policy, halfDayHours, shiftEndTime);
        imported++;
      } catch (err) {
        skipped++;
        if (errors.length < 5) errors.push(`PIN ${employee_pin}: ${err.message}`);
      }
    }

    const msg = `[collector] ${device_serial}: imported ${imported}, skipped ${skipped} of ${punches.length}`;
    console.log(msg);
    biometricEmitter.emit('log', { sn: device_serial, message: msg, timestamp: new Date().toISOString() });

    res.json({ ok: true, imported, skipped, total: punches.length, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/biometric/collector-ping ──────────────────────────────────────
// Called by the collector every poll cycle (even when no new records exist) to
// keep the device's last_seen timestamp fresh so the UI shows it as online.
router.post('/collector-ping', async (req, res) => {
  try {
    const key = req.headers['x-collector-key'];
    if (!key || key !== process.env.BIOMETRIC_COLLECTOR_KEY) {
      return res.status(401).json({ error: 'Invalid or missing collector API key' });
    }

    const { device_serial } = req.body;
    if (!device_serial || typeof device_serial !== 'string')
      return res.status(400).json({ error: 'device_serial is required' });

    const result = await pool.query(
      `UPDATE biometric_devices SET last_seen = NOW(), status = 'online'
       WHERE serial_number = $1 RETURNING id`,
      [device_serial.trim()]
    );
    if (!result.rows.length)
      return res.status(404).json({ error: `Device ${device_serial} not registered in HRMS` });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/biometric/bulk-import ─────────────────────────────────────────
// One-time or scheduled historical data import. Accepts raw EasyWDMS records
// (same schema as att_attlog) and processes them exactly like collector-push.
//
// Body: {
//   records: [{ employee_pin, punch_time, punch_type, device_serial }],
//   dry_run: false   // if true, validates without writing
// }
//
// Auth: same x-collector-key as collector-push (no JWT needed — runs server-to-server)
router.post('/bulk-import', async (req, res) => {
  try {
    const key = req.headers['x-collector-key'];
    if (!key || key !== process.env.BIOMETRIC_COLLECTOR_KEY) {
      return res.status(401).json({ error: 'Invalid or missing collector API key' });
    }

    const { records, dry_run = false } = req.body;
    if (!Array.isArray(records) || !records.length)
      return res.status(400).json({ error: 'records must be a non-empty array' });
    if (records.length > 50000)
      return res.status(400).json({ error: 'Max 50000 records per request' });

    // Group by device_serial
    const byDevice = {};
    let skippedValidation = 0;
    for (const r of records) {
      const sn  = (r.device_serial || '').trim();
      const pin = (r.employee_pin  || '').trim();
      if (!sn || !pin || !r.punch_time) { skippedValidation++; continue; }
      if (!byDevice[sn]) byDevice[sn] = [];
      byDevice[sn].push({ employee_pin: pin, punch_time: r.punch_time, punch_type: parseInt(r.punch_type ?? 0, 10) });
    }

    if (dry_run) {
      return res.json({
        ok: true,
        dry_run: true,
        devices: Object.keys(byDevice),
        valid: records.length - skippedValidation,
        skipped_validation: skippedValidation,
        total: records.length,
      });
    }

    let totalImported = 0;
    let totalSkipped  = 0;
    const errors      = [];

    for (const [sn, punches] of Object.entries(byDevice)) {
      const devRes = await pool.query(
        'SELECT id, org_id FROM biometric_devices WHERE serial_number = $1 LIMIT 1',
        [sn]
      );
      if (!devRes.rows.length) {
        errors.push(`Device ${sn} not registered — skipped ${punches.length} records`);
        totalSkipped += punches.length;
        continue;
      }
      const { org_id: orgId } = devRes.rows[0];

      for (const punch of punches) {
        const pt = new Date(punch.punch_time);
        if (isNaN(pt.getTime())) { totalSkipped++; continue; }
        if (pt < new Date('2026-08-01T00:00:00+05:30')) { totalSkipped++; continue; }

        const timeStr    = pt.toISOString().replace('T', ' ').slice(0, 19);
        const attlogLine = `${punch.employee_pin}\t${timeStr}\t${punch.punch_type}`;
        try {
          await processAttlogLine(attlogLine, orgId, sn);
          totalImported++;
        } catch (err) {
          totalSkipped++;
          if (errors.length < 10) errors.push(`PIN ${punch.employee_pin}: ${err.message}`);
        }
      }

      // Mark device online after any data from it
      await pool.query(
        `UPDATE biometric_devices SET last_seen = NOW(), status = 'online' WHERE serial_number = $1`,
        [sn]
      );
    }

    console.log(`[bulk-import] imported=${totalImported} skipped=${totalSkipped} of ${records.length}`);
    res.json({ ok: true, imported: totalImported, skipped: totalSkipped, total: records.length, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/biometric/preview-easywdms ────────────────────────────────────
// Parse file + validate + check DB for duplicates — returns counts WITHOUT writing.
// Accepts same multipart form as import-easywdms (file, date_from, date_to).
router.post('/preview-easywdms', auth, adminOnly, upload.single('file'), previewEasyWDMS);

// ─── POST /api/biometric/import-easywdms ─────────────────────────────────────
// Upload an EasyWDMS Transaction Report file (.xlsx/.xls/.csv/.tsv/.txt).
// Parses, inserts historical raw logs (bypassing go-live cutoff), auto-reprocesses.
// Optional multipart fields: date_from, date_to (YYYY-MM-DD) to filter by date range.
router.post('/import-easywdms', auth, adminOnly, upload.single('file'), importEasyWDMS);

// ─── GET /api/biometric/import-batches ───────────────────────────────────────
router.get('/import-batches', auth, adminOnly, async (req, res) => {
  try {
    const orgId = req.user.organization_id;
    const result = await pool.query(
      `SELECT b.*, u.name AS imported_by_name
       FROM biometric_import_batches b
       LEFT JOIN users u ON u.id = b.imported_by
       WHERE b.org_id = $1
       ORDER BY b.created_at DESC
       LIMIT 50`,
      [orgId]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── DELETE /api/biometric/import-batches/:id ────────────────────────────────
// Rollback: deletes raw logs for this batch and marks the batch rolled_back.
// Attendance records already created are left in place (admin must fix manually).
router.delete('/import-batches/:id', auth, adminOnly, async (req, res) => {
  try {
    const orgId = req.user.organization_id;

    const batchRes = await pool.query(
      `SELECT * FROM biometric_import_batches WHERE id = $1 AND org_id = $2 LIMIT 1`,
      [req.params.id, orgId]
    );
    if (!batchRes.rows.length) return res.status(404).json({ error: 'Batch not found' });
    if (batchRes.rows[0].status === 'rolled_back') {
      return res.status(409).json({ error: 'Batch already rolled back' });
    }

    const deleted = await pool.query(
      `DELETE FROM biometric_raw_logs
       WHERE import_batch_id = $1 AND org_id = $2
       RETURNING id`,
      [req.params.id, orgId]
    );

    await pool.query(
      `UPDATE biometric_import_batches SET status = 'rolled_back' WHERE id = $1`,
      [req.params.id]
    );

    console.log(`[import-rollback] batch=${req.params.id} deleted ${deleted.rowCount} raw logs`);
    res.json({ ok: true, deleted_logs: deleted.rowCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/biometric/devices/:id/historical-sync ──────────────────────────
//
// Triggers a date-range-filtered historical attendance recovery for one device.
// Uses the existing ZKTeco ADMS "GET ATTLOG Stamp=0" mechanism — no new device
// connections, no production code path changes.
//
// Body: { from: "YYYY-MM-DD", to: "YYYY-MM-DD", dry_run?: false }
//
// • dry_run=true  → counts records but writes ZERO rows (safe preview)
// • dry_run=false → inserts matching raw logs as source='historical_recovery'
//   (processed=false; admin must run /reprocess-all afterward to build attendance)
//
// Returns { job_id, status: "running", ... }
// Poll GET /api/biometric/historical-sync-jobs/:job_id for live progress.
router.post('/devices/:id/historical-sync', auth, adminOnly, async (req, res) => {
  try {
    const orgId = req.user.organization_id;
    const { from, to, dry_run = false } = req.body;

    // ── Input validation ───────────────────────────────────────────────────
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to are required (YYYY-MM-DD)' });
    }
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(from) || !dateRe.test(to)) {
      return res.status(400).json({ error: 'Invalid date format — use YYYY-MM-DD' });
    }
    if (new Date(from) > new Date(to)) {
      return res.status(400).json({ error: 'from must be on or before to' });
    }
    const diffDays = (new Date(to) - new Date(from)) / 86_400_000;
    if (diffDays > 366) {
      return res.status(400).json({ error: 'Date range cannot exceed 366 days' });
    }

    // ── Look up device ─────────────────────────────────────────────────────
    const devRes = await pool.query(
      `SELECT id, serial_number, device_name
       FROM biometric_devices WHERE id = $1 AND org_id = $2`,
      [req.params.id, orgId]
    );
    if (!devRes.rows.length) return res.status(404).json({ error: 'Device not found' });
    const device = devRes.rows[0];

    // ── Prevent concurrent jobs ────────────────────────────────────────────
    if (getActiveJobForSn(device.serial_number)) {
      return res.status(409).json({
        error: 'A historical sync is already running for this device — wait for it to complete.',
      });
    }
    const conflictRes = await pool.query(
      `SELECT id FROM biometric_historical_sync_jobs
       WHERE device_id = $1 AND status IN ('pending','running') LIMIT 1`,
      [device.id]
    );
    if (conflictRes.rows.length) {
      return res.status(409).json({
        error: 'A historical sync job is already pending/running for this device.',
        existing_job_id: conflictRes.rows[0].id,
      });
    }

    // ── Create DB job record ───────────────────────────────────────────────
    const jobRes = await pool.query(
      `INSERT INTO biometric_historical_sync_jobs
         (org_id, device_id, serial_number, from_date, to_date, dry_run, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'running')
       RETURNING id`,
      [orgId, device.id, device.serial_number, from, to, dry_run]
    );
    const jobId = jobRes.rows[0].id;

    // ── Activate in-memory job + trigger date-based ATTLOG query ──────────
    // Uses 'query' mode: server sends C:N:DATA QUERY ATTLOG StartTime=from
    // This queries the device's ATTLOG table by timestamp, bypassing the
    // upload-pointer that caused only 1 record to be returned after Aug 21 sync.
    // Read-only: does not modify device data or upload-pointer state.
    // If device doesn't support DATA QUERY ATTLOG, devicecmd logs Return!=0
    // and we fall back to GET ATTLOG Stamp=0 (see force-sync endpoint).
    await activateJob(device.serial_number, jobId, orgId, from, to, dry_run);
    scheduleSyncForSn(device.serial_number, 'query', { startTime: from });

    const mode = dry_run ? 'DRY RUN' : 'LIVE';
    const msg = `[historical-sync] ${mode} job ${jobId} created for ${device.device_name} (${device.serial_number}) range=${from}→${to}`;
    console.log(msg);
    biometricEmitter.emit('log', { sn: device.serial_number, message: msg, timestamp: new Date().toISOString() });

    res.json({
      ok:         true,
      job_id:     jobId,
      device:     device.device_name,
      serial:     device.serial_number,
      from,
      to,
      dry_run,
      status:     'running',
      message: dry_run
        ? `Dry-run preview started. Step 1: device upload-pointer reset. Step 2: device re-uploads all stored records (~60–120 s total). No data will be written.`
        : `Historical sync started. Step 1: device upload-pointer reset on next heartbeat. Step 2: device re-uploads full ATTLOG (~60–120 s total). Matching records inserted as source='historical_recovery' (processed=false). Run /api/biometric/reprocess-all afterward to build attendance records.`,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/biometric/historical-sync-jobs ──────────────────────────────────
// List all historical sync jobs for this org (most recent first, max 50).
router.get('/historical-sync-jobs', auth, adminOnly, async (req, res) => {
  try {
    const orgId = req.user.organization_id;
    const result = await pool.query(
      `SELECT j.*, d.device_name
       FROM biometric_historical_sync_jobs j
       LEFT JOIN biometric_devices d ON d.id = j.device_id
       WHERE j.org_id = $1
       ORDER BY j.created_at DESC
       LIMIT 50`,
      [orgId]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/biometric/historical-sync-jobs/:jobId ──────────────────────────
// Single job status — includes live in-memory stats while status='running'.
router.get('/historical-sync-jobs/:jobId', auth, adminOnly, async (req, res) => {
  try {
    const orgId = req.user.organization_id;
    const result = await pool.query(
      `SELECT j.*, d.device_name
       FROM biometric_historical_sync_jobs j
       LEFT JOIN biometric_devices d ON d.id = j.device_id
       WHERE j.id = $1 AND j.org_id = $2`,
      [req.params.jobId, orgId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Job not found' });

    const job = result.rows[0];

    // Attach live stats if job is still running
    const activeJob = getActiveJobForSn(job.serial_number);
    if (activeJob && activeJob.jobId === job.id) {
      job.live_stats = { ...activeJob.stats };
    }

    res.json(job);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/biometric/historical-sync-jobs/:jobId/reprocess ───────────────
// Scoped reprocess: re-runs attendance calculation for ONLY the employees+dates
// affected by this historical sync job — unrelated unprocessed logs are untouched.
//
// Safety rules:
//   • job must be dry_run=false and status='completed'
//   • Uses reprocessPinForDates() which reuses applyFILODay() exactly
//   • Idempotent: processed=true records are skipped (already processed)
//   • Retry-safe: imported raw logs are NOT deleted if reprocess fails
router.post('/historical-sync-jobs/:jobId/reprocess', auth, adminOnly, async (req, res) => {
  try {
    const orgId = req.user.organization_id;

    const jobRes = await pool.query(
      `SELECT id, org_id, serial_number, from_date, to_date, dry_run, status,
              records_inserted, reprocess_status
       FROM biometric_historical_sync_jobs
       WHERE id = $1 AND org_id = $2`,
      [req.params.jobId, orgId]
    );
    if (!jobRes.rows.length) return res.status(404).json({ error: 'Job not found' });
    const job = jobRes.rows[0];

    if (job.dry_run) return res.status(400).json({ error: 'Cannot reprocess a dry-run job — run a real sync first.' });
    if (job.status !== 'completed') return res.status(400).json({ error: `Job is not completed yet (status=${job.status})` });
    if (job.reprocess_status === 'running') return res.status(409).json({ error: 'Reprocess already running for this job.' });

    // Mark reprocess as started
    await pool.query(
      `UPDATE biometric_historical_sync_jobs SET reprocess_status = 'running', reprocess_started_at = NOW()
       WHERE id = $1`,
      [job.id]
    ).catch(() => {}); // column may not exist yet — graceful degradation

    // Find only PINs inserted by THIS specific job (historical_sync_job_id = jobId).
    // Falls back to device+date+source filter for records inserted before this column existed.
    const pinsRes = await pool.query(
      `SELECT DISTINCT employee_pin
       FROM biometric_raw_logs
       WHERE historical_sync_job_id = $1
         AND processed = false
       ORDER BY employee_pin`,
      [job.id]
    );

    const pins = pinsRes.rows.map(r => r.employee_pin);
    if (!pins.length) {
      await pool.query(
        `UPDATE biometric_historical_sync_jobs
         SET reprocess_status = 'completed', reprocess_completed_at = NOW(),
             employees_reprocessed = 0, attendance_records_updated = 0
         WHERE id = $1`,
        [job.id]
      ).catch(() => {});
      return res.json({ ok: true, employees_reprocessed: 0, total_logs: 0, attendance_updated: 0 });
    }

    // Respond immediately — scoped reprocess runs in background
    res.json({
      ok: true,
      message: `Reprocessing ${pins.length} employee(s) for ${job.from_date} → ${job.to_date}`,
      pins_count: pins.length,
      job_id: job.id,
    });

    setImmediate(async () => {
      let totalLogs = 0;
      let totalAttendance = 0;
      let errors = 0;

      for (const pin of pins) {
        try {
          // Pass job.id so reprocessPinForDates filters strictly by historical_sync_job_id —
          // records from previous syncs on the same device/date range are never touched.
          const r = await reprocessPinForDates(orgId, pin, job.from_date, job.to_date, job.id);
          if (!r.noMapping) {
            totalLogs       += r.total;
            totalAttendance += r.attendance_updated;
          }
        } catch (err) {
          errors++;
          console.error(`[historical-reprocess] job=${job.id} PIN=${pin} error:`, err.message);
        }
      }

      console.log(
        `[historical-reprocess] job=${job.id} done — ` +
        `pins=${pins.length} logs=${totalLogs} attendance=${totalAttendance} errors=${errors}`
      );

      await pool.query(
        `UPDATE biometric_historical_sync_jobs
         SET reprocess_status = $1, reprocess_completed_at = NOW(),
             employees_reprocessed = $2, attendance_records_updated = $3
         WHERE id = $4`,
        [errors > 0 ? 'partial' : 'completed', pins.length, totalAttendance, job.id]
      ).catch(() => {});
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/biometric/has-biometric ─────────────────────────────────────────
// Employee-facing: returns whether this org has any biometric devices registered.
// Used to gate biometric-specific UI features for the employee portal.
router.get('/has-biometric', auth, async (req, res) => {
  try {
    const orgId = req.user.organization_id;
    const result = await pool.query(
      `SELECT EXISTS(SELECT 1 FROM biometric_devices WHERE org_id = $1) AS has_biometric`,
      [orgId]
    );
    res.json({ has_biometric: result.rows[0]?.has_biometric === true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/biometric/my-punches ────────────────────────────────────────────
// Employee-facing: returns the current user's biometric raw punch logs for a date.
// Query param: date=YYYY-MM-DD (required)
router.get('/my-punches', auth, async (req, res) => {
  try {
    const orgId = req.user.organization_id;
    const uid   = req.user.id;
    const { date } = req.query;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
    }

    // Resolve the employee's biometric PIN(s) via map table OR device_enrollment_id on user row
    const pinRes = await pool.query(
      `SELECT employee_pin FROM biometric_employee_map WHERE user_id = $1 AND org_id = $2
       UNION
       SELECT device_enrollment_id AS employee_pin FROM users WHERE id = $1 AND device_enrollment_id IS NOT NULL`,
      [uid, orgId]
    );
    if (!pinRes.rows.length) return res.json([]);

    const pins = pinRes.rows.map(r => r.employee_pin).filter(Boolean);

    const logsRes = await pool.query(
      `SELECT id, punch_time, punch_type, device_serial, employee_pin
       FROM biometric_raw_logs
       WHERE org_id = $1
         AND employee_pin = ANY($2)
         AND punch_time >= $3::date
         AND punch_time < ($3::date + INTERVAL '1 day')
       ORDER BY punch_time DESC`,
      [orgId, pins, date]
    );

    res.json(logsRes.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/biometric/punches-for-date ─────────────────────────────────────
// Admin-facing: raw punch logs for a specific employee on a specific date.
// Query params: userId=<id>&date=YYYY-MM-DD
// Scoped to org + branch access. Does NOT modify raw logs (read-only).
router.get('/punches-for-date', auth, adminOnly, withBranchContext, async (req, res) => {
  try {
    const orgId = req.user.organization_id;
    const { userId, date } = req.query;

    if (!userId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      return res.status(400).json({ error: 'userId and date (YYYY-MM-DD) required' });

    const uid = parseInt(userId, 10);
    if (!Number.isFinite(uid) || uid <= 0) return res.status(400).json({ error: 'Invalid userId' });

    // Branch isolation: root_admin has org-wide access; limited admins are scoped to their branches
    if (req.user.role !== 'root_admin') {
      const ok = await canAdminAccessUser(req.branchContext, uid, orgId);
      if (!ok) return res.status(403).json({ error: "You do not have access to this employee's branch." });
    }

    // Resolve employee's biometric PIN(s) via map table OR device_enrollment_id column
    const pinRes = await pool.query(
      `SELECT employee_pin FROM biometric_employee_map WHERE user_id = $1 AND org_id = $2
       UNION
       SELECT device_enrollment_id AS employee_pin FROM users
         WHERE id = $1 AND organization_id = $2 AND device_enrollment_id IS NOT NULL`,
      [uid, orgId]
    );
    if (!pinRes.rows.length) return res.json([]);

    const pins = pinRes.rows.map(r => r.employee_pin).filter(Boolean);

    const logsRes = await pool.query(
      `SELECT id, punch_time, punch_type, device_serial, employee_pin
         FROM biometric_raw_logs
        WHERE org_id = $1
          AND employee_pin = ANY($2)
          AND punch_time >= $3::date
          AND punch_time <  ($3::date + INTERVAL '1 day')
        ORDER BY punch_time ASC`,
      [orgId, pins, date]
    );

    res.json(logsRes.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUTOMATIC BIOMETRIC SYNC — config, history, manual trigger
// Reuses the existing Historical Sync architecture (biometricHistoricalSync.handler)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/biometric/auto-sync/config ──────────────────────────────────────
router.get('/auto-sync/config', auth, adminOnly, async (req, res) => {
  try {
    const orgId = req.user.organization_id;
    const result = await pool.query(
      `SELECT id, org_id, enabled, frequency, sync_time_1, sync_time_2,
              last_sync_at, last_sync_date, last_sync_status, last_sync_error,
              created_at, updated_at
       FROM biometric_auto_sync_config
       WHERE org_id = $1 LIMIT 1`,
      [orgId]
    );
    res.json(result.rows[0] || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PUT /api/biometric/auto-sync/config ──────────────────────────────────────
// Upserts schedule config and immediately reschedules the org's timers.
router.put('/auto-sync/config', auth, adminOnly, async (req, res) => {
  try {
    const orgId = req.user.organization_id;
    const { enabled, frequency, sync_time_1, sync_time_2 } = req.body;

    const timeRe = /^\d{2}:\d{2}$/;
    if (sync_time_1 && !timeRe.test(sync_time_1))
      return res.status(400).json({ error: 'sync_time_1 must be HH:MM (e.g. 10:00)' });
    if (sync_time_2 && sync_time_2 !== '' && !timeRe.test(sync_time_2))
      return res.status(400).json({ error: 'sync_time_2 must be HH:MM (e.g. 17:00)' });

    const existsRes = await pool.query(
      `SELECT id FROM biometric_auto_sync_config WHERE org_id = $1 LIMIT 1`,
      [orgId]
    );

    if (existsRes.rows.length) {
      await pool.query(
        `UPDATE biometric_auto_sync_config
         SET enabled = $1, frequency = $2, sync_time_1 = $3, sync_time_2 = $4,
             updated_at = NOW()
         WHERE org_id = $5`,
        [enabled ?? true, frequency || 'day', sync_time_1 || '10:00', sync_time_2 || null, orgId]
      );
    } else {
      await pool.query(
        `INSERT INTO biometric_auto_sync_config (org_id, enabled, frequency, sync_time_1, sync_time_2)
         VALUES ($1, $2, $3, $4, $5)`,
        [orgId, enabled ?? true, frequency || 'day', sync_time_1 || '10:00', sync_time_2 || null]
      );
    }

    // Apply new schedule immediately — no restart required
    await autoSyncScheduler.rescheduleOrg(orgId);

    res.json({ ok: true, message: 'Auto sync configuration saved. Schedule updated.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/biometric/auto-sync/history ─────────────────────────────────────
// Returns auto-triggered historical sync jobs (same table as manual sync, filtered).
router.get('/auto-sync/history', auth, adminOnly, async (req, res) => {
  try {
    const orgId = req.user.organization_id;
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const result = await pool.query(
      `SELECT j.id, j.serial_number, j.from_date, j.to_date,
              j.status, j.created_at, j.completed_at,
              j.records_received, j.records_in_range,
              j.records_inserted, j.records_duplicate, j.records_ignored,
              j.error, d.device_name
       FROM biometric_historical_sync_jobs j
       LEFT JOIN biometric_devices d ON d.id = j.device_id
       WHERE j.org_id = $1 AND j.auto_triggered = true
       ORDER BY j.created_at DESC
       LIMIT $2`,
      [orgId, limit]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/biometric/auto-sync/trigger ────────────────────────────────────
// Manually trigger an immediate sync (for testing or on-demand use).
router.post('/auto-sync/trigger', auth, adminOnly, async (req, res) => {
  const orgId = req.user.organization_id;
  res.json({ ok: true, message: 'Sync triggered. Device(s) will upload on next heartbeat (~30–60 s). Check history for results.' });
  setImmediate(async () => {
    try {
      await autoSyncScheduler.triggerNow(orgId);
    } catch (err) {
      console.error(`[auto-sync] Manual trigger error org=${orgId}:`, err.message);
    }
  });
});

module.exports = router;
