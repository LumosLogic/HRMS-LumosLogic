/**
 * biometricPush.handler.js
 * ADMS receiver for ZKTeco devices — POST /iclock/cdata
 *
 * ZKTeco sends application/x-www-form-urlencoded:
 *   SN=<serial>  table=ATTLOG  + body lines:
 *   PIN\tTime\tStatus\tVerify\tWorkCode\tReserved
 *   e.g.: 431\t2026-07-08 09:14:23\t0\t1\t0\t0
 *
 * Rules:
 *  - Respond 'OK' immediately (device requires < 2 s)
 *  - setImmediate for all async processing
 *  - Use pool.query() directly (precise ON CONFLICT control)
 */

const { pool } = require('../../config/db-pg-adapter');
const biometricEmitter = require('../../utils/biometricEmitter');
const { getOrgPolicy }  = require('../../utils/orgPolicy');
const { applyFILODay, resolveAttendanceFlags } = require('./biometricReprocess.util');
const { ACCESS_BLOCKED_STATUSES } = require('../../utils/employeeStatus');
const historicalSync    = require('./biometricHistoricalSync.handler');

module.exports = async function biometricPushHandler(req, res) {
  // Always respond immediately — ZKTeco requires response within 2s
  res.send('OK');

  const sn    = req.query.SN    || (typeof req.body === 'object' ? req.body.SN : null);
  const table = req.query.table || (typeof req.body === 'object' ? req.body.table : null);

  if (!sn) return;
  if (table && table !== 'ATTLOG') return;

  // Prefer stream-captured raw body (set by /iclock/cdata middleware in server.js)
  // over the body-parser result which may be {} due to content-type mismatch
  const bodyForParsing = req._rawAttlog !== undefined ? req._rawAttlog : req.body;

  // Diagnostic: log exact content-type + body so we can see what device sends
  const ctHeader = req.headers['content-type'] || 'none';
  const bodySnippet = typeof bodyForParsing === 'string'
    ? bodyForParsing.slice(0, 300).replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(/\n/g, '\\n')
    : JSON.stringify(bodyForParsing);
  console.log(`[biometric] ATTLOG push SN=${sn} CT="${ctHeader}" Stamp=${req.query.Stamp} body="${bodySnippet}"`);

  const rawLines = extractAttlogLines(bodyForParsing, req.query);

  const msg = `[biometric] SN=${sn} received ${rawLines.length} ATTLOG lines`;
  console.log(msg);
  biometricEmitter.emit('log', { sn, message: msg, timestamp: new Date().toISOString() });

  if (!rawLines.length) {
    const debugMsg = `[biometric] REJECTED/EMPTY PAYLOAD SN=${sn}: "${bodySnippet}"`;
    console.log(debugMsg);
    biometricEmitter.emit('log', { sn, message: debugMsg, timestamp: new Date().toISOString() });
    return;
  }

  setImmediate(async () => {
    try {
      // 1. Look up device by serial number
      const devRes = await pool.query(
        'SELECT id, org_id FROM biometric_devices WHERE serial_number = $1 LIMIT 1',
        [sn]
      );
      if (!devRes.rows.length) {
        console.warn(`[biometric] Unknown device SN=${sn}`);
        return;
      }
      const device = devRes.rows[0];
      const orgId  = device.org_id;

      // 2. Update device last_seen + status
      await pool.query(
        `UPDATE biometric_devices SET last_seen = NOW(), status = 'online' WHERE id = $1`,
        [device.id]
      );

      // 3. Fetch org policy + half_day threshold once — shared across all lines
      const [policy, wsRes] = await Promise.all([
        getOrgPolicy(orgId),
        pool.query(`SELECT half_day_hours, end_time FROM work_schedule WHERE organization_id = $1 LIMIT 1`, [orgId]),
      ]);
      const halfDayHours = parseFloat(wsRes.rows[0]?.half_day_hours ?? 4.5);
      const shiftEndTime = wsRes.rows[0]?.end_time || '17:30';

      // ── Historical sync path ─────────────────────────────────────────────
      // If a historical sync job is active for this device, route matching lines
      // to the historical processor.  Lines outside the requested date range are
      // returned (false) and fall through to the unchanged live path below so
      // no live punch is ever silently dropped during a historical session.
      const activeHistoricalJob = historicalSync.getActiveJobForSn(sn);
      if (activeHistoricalJob) {
        let historicalCount = 0;
        for (const line of rawLines) {
          const handled = await historicalSync.processHistoricalLine(line, sn, activeHistoricalJob);
          if (!handled) await processAttlogLine(line, orgId, sn, policy, halfDayHours, shiftEndTime);
          else          historicalCount++;
        }
        historicalSync.onBatchComplete(sn, historicalCount);
        return;
      }
      // ── End historical sync path ─────────────────────────────────────────

      for (const line of rawLines) {
        await processAttlogLine(line, orgId, sn, policy, halfDayHours, shiftEndTime);
      }
    } catch (err) {
      console.error('[biometric] Push processing error:', err.message);
    }
  });
};

// ─── Parse ATTLOG lines ────────────────────────────────────────────────────────
function extractAttlogLines(body, query = {}) {
  const lines = [];

  function parseLine(text) {
    if (!text || typeof text !== 'string') return;
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && trimmed.includes('\t') && /^[a-zA-Z0-9_\-]+\t/.test(trimmed)) {
        lines.push(trimmed);
      }
    }
  }

  if (typeof body === 'string') {
    parseLine(body);
    if (!lines.length && body.includes('%09')) {
      try { parseLine(decodeURIComponent(body.replace(/\+/g, ' '))); } catch (_) {}
    }
    return lines;
  }

  if (body && typeof body === 'object') {
    for (const key of Object.keys(body)) {
      if (/^[a-zA-Z0-9_\-]+\t/.test(key)) parseLine(key);
    }
    for (const val of Object.values(body)) {
      parseLine(val);
    }
  }

  for (const val of Object.values(query)) {
    parseLine(val);
  }

  return lines;
}

// A LIVE punch from an inactive / terminated account is meaningless (the person no longer works here) and must not
// create attendance. Only recent punches are gated — historical imports and re-processing of a leaver's real past
// days are untouched. The raw log is kept (marked processed) as evidence.
async function isLockedAccountPunch(userId, orgId, punchDate) {
  try {
    const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const y = new Date(todayIST + 'T12:00:00Z'); y.setUTCDate(y.getUTCDate() - 1);
    if (punchDate < y.toISOString().slice(0, 10)) return false;   // older than yesterday → history, not a live punch
    const r = await pool.query('SELECT employee_status FROM users WHERE id = $1 AND organization_id = $2', [userId, orgId]);
    return ACCESS_BLOCKED_STATUSES.includes(r.rows[0]?.employee_status);
  } catch { return false; }
}

// ─── Process a single ATTLOG line ─────────────────────────────────────────────
async function processAttlogLine(line, orgId, deviceSerial, policy = 'standard', halfDayHours = 4.5, shiftEndTime = '17:30') {
  const parts = line.split('\t');
  if (parts.length < 3) return;

  const pin       = parts[0].trim();
  const timeStr   = parts[1].trim();   // "2026-07-08 09:14:23"
  const punchType = parseInt(parts[2].trim(), 10); // 0=in, 1=out

  const punchTime = new Date(timeStr);
  if (isNaN(punchTime.getTime())) {
    console.warn('[biometric] Invalid punch time:', timeStr);
    return;
  }

  // Hard cutoff: ignore punches before August 1st, 2026 (Go-Live Date)
  if (punchTime < new Date('2026-08-01T00:00:00+05:30')) {
    return;
  }

  const punchDate    = punchTime.toISOString().slice(0, 10); // YYYY-MM-DD
  const punchTimeStr = punchTime.toTimeString().slice(0, 8); // HH:MM:SS

  // Upsert raw log (idempotent via ON CONFLICT DO NOTHING)
  let rawLogId;
  try {
    const logRes = await pool.query(
      `INSERT INTO biometric_raw_logs
         (org_id, device_serial, employee_pin, punch_time, punch_type, processed, source)
       VALUES ($1, $2, $3, $4, $5, false, 'adms_live')
       ON CONFLICT (device_serial, punch_time, employee_pin) DO NOTHING
       RETURNING id`,
      [orgId, deviceSerial, pin, punchTime.toISOString(), punchType]
    );
    if (!logRes.rows.length) return; // duplicate — already processed
    rawLogId = logRes.rows[0].id;
  } catch (err) {
    console.error('[biometric] Raw log upsert error:', err.message);
    return;
  }

  // ── FILO path ──────────────────────────────────────────────────────────────
  if (policy === 'first_in_last_out') {
    const mapRes = await pool.query(
      `SELECT user_id FROM biometric_employee_map
       WHERE org_id = $1 AND employee_pin = $2 LIMIT 1`,
      [orgId, pin]
    );
    if (!mapRes.rows.length) return; // no mapping — leave unprocessed for later

    const userId = mapRes.rows[0].user_id;
    if (await isLockedAccountPunch(userId, orgId, punchDate)) {
      await pool.query(`UPDATE biometric_raw_logs SET processed = true WHERE id = $1`, [rawLogId]);
      return;
    }

    // Leave guard
    const attRes = await pool.query(
      `SELECT id, status FROM attendance WHERE user_id = $1 AND date = $2 LIMIT 1`,
      [userId, punchDate]
    );
    const att = attRes.rows[0] || null;

    // Leave guard — only block on full-day leave or WFH; allow half_day to be recalculated
    if (att && ['on_leave', 'wfh'].includes(att.status)) {
      await pool.query(`UPDATE biometric_raw_logs SET processed = true WHERE id = $1`, [rawLogId]);
      return;
    }

    // Fetch ALL raw logs for this employee+date and recompute attendance
    const allLogsRes = await pool.query(
      `SELECT id, punch_time, punch_type FROM biometric_raw_logs
       WHERE org_id = $1 AND employee_pin = $2
         AND punch_time >= $3::date
         AND punch_time <  $3::date + INTERVAL '1 day'
       ORDER BY punch_time`,
      [orgId, pin, punchDate]
    );

    await applyFILODay(userId, punchDate, orgId, allLogsRes.rows, att, halfDayHours, shiftEndTime);
    await pool.query(`UPDATE biometric_raw_logs SET processed = true WHERE id = $1`, [rawLogId]);
    return;
  }

  // ── Standard path (original logic — untouched) ────────────────────────────
  const mapRes = await pool.query(
    `SELECT user_id FROM biometric_employee_map
     WHERE org_id = $1 AND employee_pin = $2 LIMIT 1`,
    [orgId, pin]
  );
  if (!mapRes.rows.length) return;
  const userId = mapRes.rows[0].user_id;
  if (await isLockedAccountPunch(userId, orgId, punchDate)) {
    await pool.query(`UPDATE biometric_raw_logs SET processed = true WHERE id = $1`, [rawLogId]);
    return;
  }

  const attRes = await pool.query(
    `SELECT id, status, check_in, check_out, total_break_minutes FROM attendance
     WHERE user_id = $1 AND date = $2 LIMIT 1`,
    [userId, punchDate]
  );
  const att = attRes.rows[0] || null;

  if (att && ['on_leave', 'half_day', 'wfh'].includes(att.status)) {
    await pool.query(`UPDATE biometric_raw_logs SET processed = true WHERE id = $1`, [rawLogId]);
    return;
  }

  if (punchType === 0) {
    if (!att) {
      const { isLate } = await resolveAttendanceFlags(userId, orgId, punchDate, punchTimeStr, null);
      await pool.query(
        `INSERT INTO attendance (user_id, date, check_in, status, source, organization_id, is_late)
         VALUES ($1, $2, $3, 'present', 'biometric', $4, $5)
         ON CONFLICT (user_id, date, organization_id) DO NOTHING`,
        [userId, punchDate, punchTimeStr, orgId, isLate]
      );
    }
  }

  if (punchType === 1) {
    if (att && att.check_in) {
      const checkInMs  = new Date(`${punchDate}T${att.check_in}`).getTime();
      const checkOutMs = punchTime.getTime();
      const grossHours = parseFloat(((checkOutMs - checkInMs) / 3600000).toFixed(2));
      const breakMins  = att.total_break_minutes || 0;
      const workHours  = parseFloat(Math.max(0, grossHours - breakMins / 60).toFixed(2));
      const { isEarlyExit } = await resolveAttendanceFlags(userId, orgId, punchDate, null, punchTimeStr);
      await pool.query(
        `UPDATE attendance
         SET check_out = $1, gross_hours = $2, work_hours = $3, source = 'biometric', is_early_exit = $5
         WHERE id = $4`,
        [punchTimeStr, grossHours, workHours, att.id, isEarlyExit]
      );
    } else if (!att) {
      await pool.query(
        `INSERT INTO attendance (user_id, date, check_out, status, source, organization_id)
         VALUES ($1, $2, $3, 'present', 'biometric', $4)
         ON CONFLICT (user_id, date, organization_id) DO UPDATE
           SET check_out = EXCLUDED.check_out, source = 'biometric'`,
        [userId, punchDate, punchTimeStr, orgId]
      );
    }
  }

  await pool.query(`UPDATE biometric_raw_logs SET processed = true WHERE id = $1`, [rawLogId]);
}

// Exported for use by the collector-push endpoint (bulk import from EasyWDMS agent)
module.exports.processAttlogLine = processAttlogLine;
