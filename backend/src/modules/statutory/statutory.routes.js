'use strict';
/**
 * statutory.routes.js — Phase 3.7
 * All statutory compliance endpoints.
 * Mounted at /api/statutory
 */

const express  = require('express');
const router   = express.Router();
const { pool } = require('../../config/db');
const { auth } = require('../../middleware/auth');
const { hasPermission } = require('../../middleware/permissions');
const { orgId }         = require('../../utils/helpers');
const { withBranchContext } = require('../../middleware/branchContext');
const { resolveEmployeeIds } = require('../../utils/branchFilter');

const {
  applyStatutoryCalculations,
  loadAllStatutoryConfigs,
  getFY,
} = require('../../services/statutoryCalculationService');

const {
  getPFECR, getESIReturn, getPTChallan,
  getTDSChallan, getForm16Dataset, getComplianceSummary,
  toCsv, PF_ECR_FIELDS, ESI_FIELDS,
} = require('../../services/statutoryReportService');

// ─── Audit helper ─────────────────────────────────────────────────────────────
function logAudit({ oId, actorId, actorName, action, entityType, entityId, newValues, ip }) {
  pool.query(
    `INSERT INTO payroll_audit_log
       (organization_id, actor_id, actor_name, action, entity_type, entity_id, new_values, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [oId, actorId || null, actorName || null, action, entityType, entityId || null,
     newValues ? JSON.stringify(newValues) : null, ip || null]
  ).catch(() => {});
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG — GET/PUT ALL STATUTORY CONFIGS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/statutory/config — load all configs for org
router.get('/config', auth, hasPermission('statutory', 'view'), async (req, res) => {
  try {
    const oId     = orgId(req);
    const configs = await loadAllStatutoryConfigs(oId);

    // Also load PT and LWF state lists
    const [ptStates, lwfStates, bonusConfig] = await Promise.all([
      pool.query(`SELECT state_code, state_name FROM statutory_pt_slabs ORDER BY state_name`),
      pool.query(`SELECT state_code, state_name FROM statutory_lwf_slabs WHERE employee_amount > 0 OR employer_amount > 0 ORDER BY state_name`),
      pool.query(`SELECT * FROM statutory_bonus_config WHERE organization_id = $1`, [oId]),
    ]);

    res.json({
      ...configs,
      bonus:    bonusConfig.rows[0] || null,
      ptStates: ptStates.rows,
      lwfStates: lwfStates.rows,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/statutory/config/pf
router.put('/config/pf', auth, hasPermission('statutory', 'configure'), async (req, res) => {
  try {
    const oId = orgId(req);
    const {
      enabled, employee_pf_pct, employer_epf_pct, employer_eps_pct,
      wage_ceiling, pf_wage_basis, vpf_enabled, vpf_pct,
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO statutory_pf_config
           (organization_id, enabled, employee_pf_pct, employer_epf_pct, employer_eps_pct,
            wage_ceiling, pf_wage_basis, vpf_enabled, vpf_pct, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       ON CONFLICT (organization_id) DO UPDATE SET
           enabled           = EXCLUDED.enabled,
           employee_pf_pct   = EXCLUDED.employee_pf_pct,
           employer_epf_pct  = EXCLUDED.employer_epf_pct,
           employer_eps_pct  = EXCLUDED.employer_eps_pct,
           wage_ceiling      = EXCLUDED.wage_ceiling,
           pf_wage_basis     = EXCLUDED.pf_wage_basis,
           vpf_enabled       = EXCLUDED.vpf_enabled,
           vpf_pct           = EXCLUDED.vpf_pct,
           updated_by        = EXCLUDED.updated_by,
           updated_at        = NOW()
       RETURNING *`,
      [oId, Boolean(enabled), employee_pf_pct ?? 12, employer_epf_pct ?? 3.67,
       employer_eps_pct ?? 8.33, wage_ceiling ?? 15000, pf_wage_basis || 'basic',
       Boolean(vpf_enabled), vpf_pct ?? 0, req.user.id]
    );

    logAudit({ oId, actorId: req.user.id, actorName: req.user.name,
      action: 'statutory_config_updated', entityType: 'statutory_config',
      newValues: { type: 'pf', ...rows[0] }, ip: req.ip });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/statutory/config/esi
router.put('/config/esi', auth, hasPermission('statutory', 'configure'), async (req, res) => {
  try {
    const oId = orgId(req);
    const { enabled, employee_esi_pct, employer_esi_pct, wage_limit } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO statutory_esi_config
           (organization_id, enabled, employee_esi_pct, employer_esi_pct, wage_limit, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (organization_id) DO UPDATE SET
           enabled          = EXCLUDED.enabled,
           employee_esi_pct = EXCLUDED.employee_esi_pct,
           employer_esi_pct = EXCLUDED.employer_esi_pct,
           wage_limit       = EXCLUDED.wage_limit,
           updated_by       = EXCLUDED.updated_by,
           updated_at       = NOW()
       RETURNING *`,
      [oId, Boolean(enabled), employee_esi_pct ?? 0.75, employer_esi_pct ?? 3.25,
       wage_limit ?? 21000, req.user.id]
    );
    logAudit({ oId, actorId: req.user.id, actorName: req.user.name,
      action: 'statutory_config_updated', entityType: 'statutory_config',
      newValues: { type: 'esi', ...rows[0] }, ip: req.ip });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/statutory/config/pt
router.put('/config/pt', auth, hasPermission('statutory', 'configure'), async (req, res) => {
  try {
    const oId = orgId(req);
    const { enabled, state_code, custom_slabs } = req.body;
    if (!state_code) return res.status(400).json({ error: 'state_code is required' });

    const { rows } = await pool.query(
      `INSERT INTO statutory_pt_config
           (organization_id, enabled, state_code, custom_slabs, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (organization_id) DO UPDATE SET
           enabled      = EXCLUDED.enabled,
           state_code   = EXCLUDED.state_code,
           custom_slabs = EXCLUDED.custom_slabs,
           updated_by   = EXCLUDED.updated_by,
           updated_at   = NOW()
       RETURNING *`,
      [oId, Boolean(enabled), state_code, custom_slabs ? JSON.stringify(custom_slabs) : null, req.user.id]
    );
    logAudit({ oId, actorId: req.user.id, actorName: req.user.name,
      action: 'statutory_config_updated', entityType: 'statutory_config',
      newValues: { type: 'pt', state_code }, ip: req.ip });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/statutory/config/tds
router.put('/config/tds', auth, hasPermission('statutory', 'configure'), async (req, res) => {
  try {
    const oId = orgId(req);
    const {
      enabled, default_regime, fy_start_month,
      standard_deduction_old, standard_deduction_new,
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO statutory_tds_config
           (organization_id, enabled, default_regime, fy_start_month,
            standard_deduction_old, standard_deduction_new, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (organization_id) DO UPDATE SET
           enabled               = EXCLUDED.enabled,
           default_regime        = EXCLUDED.default_regime,
           fy_start_month        = EXCLUDED.fy_start_month,
           standard_deduction_old= EXCLUDED.standard_deduction_old,
           standard_deduction_new= EXCLUDED.standard_deduction_new,
           updated_by            = EXCLUDED.updated_by,
           updated_at            = NOW()
       RETURNING *`,
      [oId, Boolean(enabled), default_regime || 'new', fy_start_month || 4,
       standard_deduction_old || 50000, standard_deduction_new || 75000, req.user.id]
    );
    logAudit({ oId, actorId: req.user.id, actorName: req.user.name,
      action: 'statutory_config_updated', entityType: 'statutory_config',
      newValues: { type: 'tds', ...rows[0] }, ip: req.ip });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/statutory/config/gratuity
router.put('/config/gratuity', auth, hasPermission('statutory', 'configure'), async (req, res) => {
  try {
    const oId = orgId(req);
    const { enabled, min_service_years, wage_basis, working_days_denominator, days_per_year, max_gratuity } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO statutory_gratuity_config
           (organization_id, enabled, min_service_years, wage_basis,
            working_days_denominator, days_per_year, max_gratuity, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (organization_id) DO UPDATE SET
           enabled                  = EXCLUDED.enabled,
           min_service_years        = EXCLUDED.min_service_years,
           wage_basis               = EXCLUDED.wage_basis,
           working_days_denominator = EXCLUDED.working_days_denominator,
           days_per_year            = EXCLUDED.days_per_year,
           max_gratuity             = EXCLUDED.max_gratuity,
           updated_by               = EXCLUDED.updated_by,
           updated_at               = NOW()
       RETURNING *`,
      [oId, Boolean(enabled), min_service_years || 5, wage_basis || 'basic',
       working_days_denominator || 26, days_per_year || 15, max_gratuity || 2000000, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/statutory/config/lwf
router.put('/config/lwf', auth, hasPermission('statutory', 'configure'), async (req, res) => {
  try {
    const oId = orgId(req);
    const { enabled, state_code } = req.body;
    if (!state_code) return res.status(400).json({ error: 'state_code is required' });

    const { rows } = await pool.query(
      `INSERT INTO statutory_lwf_config
           (organization_id, enabled, state_code, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (organization_id) DO UPDATE SET
           enabled    = EXCLUDED.enabled,
           state_code = EXCLUDED.state_code,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
       RETURNING *`,
      [oId, Boolean(enabled), state_code, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/statutory/config/bonus
router.put('/config/bonus', auth, hasPermission('statutory', 'configure'), async (req, res) => {
  try {
    const oId = orgId(req);
    const {
      statutory_bonus_enabled, statutory_bonus_pct, statutory_wage_ceiling,
      statutory_wage_floor, festival_bonus_enabled, festival_bonus_months,
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO statutory_bonus_config
           (organization_id, statutory_bonus_enabled, statutory_bonus_pct,
            statutory_wage_ceiling, statutory_wage_floor, festival_bonus_enabled,
            festival_bonus_months, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (organization_id) DO UPDATE SET
           statutory_bonus_enabled = EXCLUDED.statutory_bonus_enabled,
           statutory_bonus_pct     = EXCLUDED.statutory_bonus_pct,
           statutory_wage_ceiling  = EXCLUDED.statutory_wage_ceiling,
           statutory_wage_floor    = EXCLUDED.statutory_wage_floor,
           festival_bonus_enabled  = EXCLUDED.festival_bonus_enabled,
           festival_bonus_months   = EXCLUDED.festival_bonus_months,
           updated_by              = EXCLUDED.updated_by,
           updated_at              = NOW()
       RETURNING *`,
      [oId, Boolean(statutory_bonus_enabled), statutory_bonus_pct || 8.33,
       statutory_wage_ceiling || 21000, statutory_wage_floor || 7000,
       Boolean(festival_bonus_enabled),
       festival_bonus_months ? JSON.stringify(festival_bonus_months) : JSON.stringify([10]),
       req.user.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TAX DECLARATIONS (Employee self-service)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/statutory/declarations — employee: own; HR: all (branch-filtered)
router.get('/declarations', auth, withBranchContext, async (req, res) => {
  try {
    const oId    = orgId(req);
    const isHR   = ['admin','root_admin'].includes(req.user.role);
    const { fy, userId, status } = req.query;

    const conds  = ['d.organization_id = $1'];
    const params = [oId];

    if (!isHR) {
      // Employee: own only — no branch filter needed
      conds.push(`d.user_id = $${params.length + 1}`);
      params.push(req.user.id);
    } else if (userId) {
      conds.push(`d.user_id = $${params.length + 1}`);
      params.push(parseInt(userId, 10));
    } else {
      // HR listing all: restrict to accessible branches via employee branch membership
      const accessibleIds = await resolveEmployeeIds(req.branchContext, oId);
      if (accessibleIds !== null) {
        if (accessibleIds.length === 0) return res.json([]);
        conds.push(`d.user_id = ANY($${params.length + 1}::bigint[])`);
        params.push(accessibleIds);
      }
    }
    if (fy)     { conds.push(`d.financial_year = $${params.length + 1}`); params.push(fy); }
    if (status) { conds.push(`d.status = $${params.length + 1}`);         params.push(status); }

    const { rows } = await pool.query(
      `SELECT d.*, u.name AS employee_name, u.employee_id,
              r.name AS reviewed_by_name
         FROM statutory_tds_declarations d
         JOIN users u ON u.id = d.user_id
         LEFT JOIN users r ON r.id = d.reviewed_by
        WHERE ${conds.join(' AND ')}
        ORDER BY d.financial_year DESC, d.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/statutory/declarations — employee submits declaration
router.post('/declarations', auth, hasPermission('statutory', 'declare'), async (req, res) => {
  try {
    const oId = orgId(req);
    const now  = new Date();
    const fy   = getFY(now.getMonth() + 1, now.getFullYear());

    const {
      regime, financial_year,
      prev_employer_income, prev_employer_tds, other_income,
      deduction_80c, deduction_80d_self, deduction_80d_parents,
      deduction_80ccd, deduction_hra, deduction_home_loan, deduction_other,
      hra_rent_paid_annual, hra_city_type,
    } = req.body;

    const targetFY = financial_year || fy;

    const { rows } = await pool.query(
      `INSERT INTO statutory_tds_declarations
           (organization_id, user_id, financial_year, regime,
            prev_employer_income, prev_employer_tds, other_income,
            deduction_80c, deduction_80d_self, deduction_80d_parents,
            deduction_80ccd, deduction_hra, deduction_home_loan, deduction_other,
            hra_rent_paid_annual, hra_city_type,
            status, submitted_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               'submitted', NOW(), NOW())
       ON CONFLICT (organization_id, user_id, financial_year) DO UPDATE SET
           regime                = EXCLUDED.regime,
           prev_employer_income  = EXCLUDED.prev_employer_income,
           prev_employer_tds     = EXCLUDED.prev_employer_tds,
           other_income          = EXCLUDED.other_income,
           deduction_80c         = EXCLUDED.deduction_80c,
           deduction_80d_self    = EXCLUDED.deduction_80d_self,
           deduction_80d_parents = EXCLUDED.deduction_80d_parents,
           deduction_80ccd       = EXCLUDED.deduction_80ccd,
           deduction_hra         = EXCLUDED.deduction_hra,
           deduction_home_loan   = EXCLUDED.deduction_home_loan,
           deduction_other       = EXCLUDED.deduction_other,
           hra_rent_paid_annual  = EXCLUDED.hra_rent_paid_annual,
           hra_city_type         = EXCLUDED.hra_city_type,
           status                = CASE
             WHEN statutory_tds_declarations.status = 'approved' THEN 'hr_review'
             ELSE 'submitted'
           END,
           submitted_at          = NOW(),
           updated_at            = NOW()
       RETURNING *`,
      [oId, req.user.id, targetFY, regime || 'new',
       prev_employer_income || 0, prev_employer_tds || 0, other_income || 0,
       deduction_80c || 0, deduction_80d_self || 0, deduction_80d_parents || 0,
       deduction_80ccd || 0, deduction_hra || 0, deduction_home_loan || 0, deduction_other || 0,
       hra_rent_paid_annual || 0, hra_city_type || 'non_metro']
    );

    logAudit({ oId, actorId: req.user.id, actorName: req.user.name,
      action: 'declaration_submitted', entityType: 'tds_declaration',
      entityId: rows[0].id, newValues: { fy: targetFY, regime }, ip: req.ip });

    // Fire-and-forget: notify HR admins so they know a declaration is pending review
    pool.query(
      `SELECT id FROM users WHERE role IN ('admin','root_admin') AND organization_id = $1`,
      [oId]
    ).then(({ rows: admins }) => {
      if (!admins.length) return;
      const ids = admins.map(a => a.id);
      return pool.query(
        `INSERT INTO notifications (user_id, title, message, type, organization_id)
         SELECT unnest($1::bigint[]), $2, $3, 'statutory', $4`,
        [ids,
         'TDS Declaration Submitted',
         `${req.user.name} submitted a tax declaration for FY ${targetFY}. Review required.`,
         oId]
      );
    }).catch(() => {});

    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/statutory/declarations/:id/approve — HR approves
router.put('/declarations/:id/approve', auth, hasPermission('statutory', 'approve_declarations'), async (req, res) => {
  try {
    const oId = orgId(req);
    const id  = parseInt(req.params.id, 10);
    const { reviewer_notes } = req.body;

    const { rows } = await pool.query(
      `UPDATE statutory_tds_declarations
          SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(),
              reviewer_notes = $2, updated_at = NOW()
        WHERE id = $3 AND organization_id = $4
       RETURNING *`,
      [req.user.id, reviewer_notes || null, id, oId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Declaration not found' });

    logAudit({ oId, actorId: req.user.id, actorName: req.user.name,
      action: 'declaration_approved', entityType: 'tds_declaration',
      entityId: id, ip: req.ip });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/statutory/declarations/:id/reject
router.put('/declarations/:id/reject', auth, hasPermission('statutory', 'approve_declarations'), async (req, res) => {
  try {
    const oId = orgId(req);
    const id  = parseInt(req.params.id, 10);
    const { reviewer_notes } = req.body;
    if (!reviewer_notes) return res.status(400).json({ error: 'reviewer_notes required when rejecting' });

    const { rows } = await pool.query(
      `UPDATE statutory_tds_declarations
          SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(),
              reviewer_notes = $2, updated_at = NOW()
        WHERE id = $3 AND organization_id = $4
       RETURNING *`,
      [req.user.id, reviewer_notes, id, oId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Declaration not found' });

    logAudit({ oId, actorId: req.user.id, actorName: req.user.name,
      action: 'declaration_rejected', entityType: 'tds_declaration',
      entityId: id, ip: req.ip });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// INVESTMENT PROOFS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/statutory/proofs — employee: own; HR: accessible branches only
router.get('/proofs', auth, withBranchContext, async (req, res) => {
  try {
    const oId    = orgId(req);
    const isHR   = ['admin','root_admin'].includes(req.user.role);
    const { declarationId, status } = req.query;

    const conds  = ['ip.organization_id = $1', 'ip.deleted_at IS NULL'];
    const params = [oId];

    if (!isHR) {
      // Employee: own only — no branch filter needed
      conds.push(`ip.user_id = $${params.length + 1}`);
      params.push(req.user.id);
    } else {
      // HR listing all: restrict to accessible branches via employee branch membership
      const accessibleIds = await resolveEmployeeIds(req.branchContext, oId);
      if (accessibleIds !== null) {
        if (accessibleIds.length === 0) return res.json([]);
        conds.push(`ip.user_id = ANY($${params.length + 1}::bigint[])`);
        params.push(accessibleIds);
      }
    }
    if (declarationId) {
      conds.push(`ip.declaration_id = $${params.length + 1}`);
      params.push(parseInt(declarationId, 10));
    }
    if (status) { conds.push(`ip.status = $${params.length + 1}`); params.push(status); }

    const { rows } = await pool.query(
      `SELECT ip.*, u.name AS employee_name, r.name AS reviewed_by_name
         FROM statutory_investment_proofs ip
         JOIN users u ON u.id = ip.user_id
         LEFT JOIN users r ON r.id = ip.reviewed_by
        WHERE ${conds.join(' AND ')}
        ORDER BY ip.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/statutory/proofs
router.post('/proofs', auth, hasPermission('statutory', 'declare'), async (req, res) => {
  try {
    const oId = orgId(req);
    const { declaration_id, proof_type, description, claimed_amount, document_url, document_name } = req.body;
    if (!declaration_id || !proof_type) return res.status(400).json({ error: 'declaration_id and proof_type are required' });

    const { rows } = await pool.query(
      `INSERT INTO statutory_investment_proofs
           (organization_id, declaration_id, user_id, proof_type, description,
            claimed_amount, document_url, document_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [oId, parseInt(declaration_id, 10), req.user.id, proof_type,
       description || '', claimed_amount || 0, document_url || null, document_name || null]
    );

    // Notify HR admins: investment proof awaiting review (fire-and-forget)
    pool.query(
      `INSERT INTO notifications (user_id, title, message, type, organization_id)
       SELECT id, $1, $2, 'statutory', $3
       FROM users WHERE organization_id = $3 AND role IN ('admin','root_admin')`,
      [`Investment Proof Uploaded — Review Needed`,
       `${req.user.name} uploaded a ${proof_type.replace(/_/g,' ')} investment proof. Please review it in the TDS declarations section.`,
       oId]
    ).catch(() => {});

    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/statutory/proofs/:id/review — HR approve/reject
router.put('/proofs/:id/review', auth, hasPermission('statutory', 'approve_declarations'), async (req, res) => {
  try {
    const oId = orgId(req);
    const id  = parseInt(req.params.id, 10);
    const { status, rejection_reason } = req.body;
    const allowed = ['approved','rejected','needs_reupload'];
    if (!allowed.includes(status)) return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });

    const { rows } = await pool.query(
      `UPDATE statutory_investment_proofs
          SET status = $1, reviewed_by = $2, reviewed_at = NOW(),
              rejection_reason = $3, updated_at = NOW()
        WHERE id = $4 AND organization_id = $5 AND deleted_at IS NULL
       RETURNING *`,
      [status, req.user.id, rejection_reason || null, id, oId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Proof not found' });

    logAudit({ oId, actorId: req.user.id, actorName: req.user.name,
      action: status === 'approved' ? 'proof_approved' : 'proof_rejected',
      entityType: 'investment_proof', entityId: id, ip: req.ip });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMPLIANCE DASHBOARD & RETURNS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/statutory/compliance-summary?month=&year=
router.get('/compliance-summary', auth, hasPermission('statutory', 'view'), async (req, res) => {
  try {
    const oId   = orgId(req);
    const month = parseInt(req.query.month || new Date().getMonth() + 1, 10);
    const year  = parseInt(req.query.year  || new Date().getFullYear(),  10);
    const data  = await getComplianceSummary({ organizationId: oId, month, year });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/statutory/returns
router.get('/returns', auth, hasPermission('statutory', 'view'), async (req, res) => {
  try {
    const oId = orgId(req);
    const { rows } = await pool.query(
      `SELECT * FROM statutory_compliance_returns
        WHERE organization_id = $1
        ORDER BY due_date DESC, created_at DESC
        LIMIT 100`,
      [oId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/statutory/returns — create return tracking entry
router.post('/returns', auth, hasPermission('statutory', 'configure'), async (req, res) => {
  try {
    const oId = orgId(req);
    const { return_type, period_month, period_year, financial_year, due_date, amount, notes } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO statutory_compliance_returns
           (organization_id, return_type, period_month, period_year, financial_year,
            due_date, amount, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
       RETURNING *`,
      [oId, return_type, period_month || null, period_year || null,
       financial_year || null, due_date || null, amount || null, notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/statutory/returns/:id/filed
router.put('/returns/:id/filed', auth, hasPermission('statutory', 'file_returns'), async (req, res) => {
  try {
    const oId = orgId(req);
    const id  = parseInt(req.params.id, 10);
    const { challan_number, filed_date, notes } = req.body;

    const { rows } = await pool.query(
      `UPDATE statutory_compliance_returns
          SET status = 'filed', filed_date = $1, challan_number = $2,
              notes = COALESCE($3, notes), filed_by = $4, updated_at = NOW()
        WHERE id = $5 AND organization_id = $6
       RETURNING *`,
      [filed_date || new Date().toISOString().split('T')[0],
       challan_number || null, notes || null, req.user.id, id, oId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Return not found' });

    logAudit({ oId, actorId: req.user.id, actorName: req.user.name,
      action: 'return_filed', entityType: 'compliance_return', entityId: id,
      newValues: { challan_number, filed_date }, ip: req.ip });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// STATUTORY REPORTS
// ═══════════════════════════════════════════════════════════════════════════════

function rParams(req) {
  return {
    organizationId: orgId(req),
    month: req.query.month ? parseInt(req.query.month, 10) : new Date().getMonth() + 1,
    year:  req.query.year  ? parseInt(req.query.year,  10) : new Date().getFullYear(),
  };
}

function sendCSV(res, data, fields, filename) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(data, fields));
}

// GET /api/statutory/reports/pf-ecr
router.get('/reports/pf-ecr', auth, hasPermission('statutory', 'view'), async (req, res) => {
  try {
    const p    = rParams(req);
    const data = await getPFECR(p);
    if (req.query.format === 'csv') return sendCSV(res, data, PF_ECR_FIELDS, 'pf_ecr.csv');
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/statutory/reports/esi
router.get('/reports/esi', auth, hasPermission('statutory', 'view'), async (req, res) => {
  try {
    const p    = rParams(req);
    const data = await getESIReturn(p);
    if (req.query.format === 'csv') return sendCSV(res, data, ESI_FIELDS, 'esi_return.csv');
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/statutory/reports/pt
router.get('/reports/pt', auth, hasPermission('statutory', 'view'), async (req, res) => {
  try {
    const p    = rParams(req);
    const data = await getPTChallan(p);
    if (req.query.format === 'csv') {
      const fields = [
        { key: 'employee_id', label: 'Emp ID' }, { key: 'employee_name', label: 'Name' },
        { key: 'department' }, { key: 'gross_salary', label: 'Gross' },
        { key: 'pt_amount', label: 'PT Amount' },
      ];
      return sendCSV(res, data.rows, fields, 'pt_challan.csv');
    }
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/statutory/reports/tds
router.get('/reports/tds', auth, hasPermission('statutory', 'view'), async (req, res) => {
  try {
    const p    = rParams(req);
    const data = await getTDSChallan(p);
    if (req.query.format === 'csv') {
      const fields = [
        { key: 'employee_id', label: 'Emp ID' }, { key: 'employee_name', label: 'Name' },
        { key: 'pan' }, { key: 'gross_salary', label: 'Gross' },
        { key: 'monthly_tds', label: 'Monthly TDS' },
        { key: 'annual_projected', label: 'Projected Annual Tax' },
        { key: 'ytd_tds', label: 'YTD TDS' }, { key: 'regime' },
      ];
      return sendCSV(res, data.rows, fields, 'tds_challan.csv');
    }
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/statutory/reports/form16?fy=2024-25
router.get('/reports/form16', auth, hasPermission('payroll', 'form16'), async (req, res) => {
  try {
    const oId = orgId(req);
    const fy  = req.query.fy || getFY(new Date().getMonth() + 1, new Date().getFullYear());
    const data = await getForm16Dataset({ organizationId: oId, financialYear: fy });
    if (req.query.format === 'csv') {
      const fields = [
        { key: 'employee_id', label: 'Emp ID' }, { key: 'employee_name', label: 'Name' },
        { key: 'pan' }, { key: 'department' }, { key: 'designation' },
        { key: 'financial_year', label: 'FY' },
        { key: 'annual_gross', label: 'Gross Income' },
        { key: 'annual_pf', label: 'PF' }, { key: 'annual_esi', label: 'ESI' },
        { key: 'annual_pt', label: 'PT' }, { key: 'annual_tds', label: 'TDS Deducted' },
        { key: 'annual_deductions', label: 'Total Deductions' },
        { key: 'annual_net', label: 'Net Salary' },
        { key: 'projected_tax', label: 'Tax Liability' }, { key: 'regime' },
      ];
      return sendCSV(res, data, fields, `form16_${fy}.csv`);
    }
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/statutory/pt-slabs — all seeded state slabs
router.get('/pt-slabs', auth, hasPermission('statutory', 'view'), async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM statutory_pt_slabs ORDER BY state_name`);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/statutory/lwf-slabs
router.get('/lwf-slabs', auth, hasPermission('statutory', 'view'), async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM statutory_lwf_slabs ORDER BY state_name`);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
