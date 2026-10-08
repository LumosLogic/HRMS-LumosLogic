const express = require('express');
const router  = express.Router();
const { V, validateBody } = require('../../utils/fieldValidators');
const { db }              = require('../../config/db');
const { auth, isAdminRole } = require('../../middleware/auth');
const { orgId }                 = require('../../utils/helpers');

// GET /api/profile/:id/education
router.get('/:id/education', auth, async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    if (!isAdminRole(req.user.role) && parseInt(req.user.id) !== empId)
      return res.status(403).json({ error: 'Access denied' });

    const { data, error } = await db.from('employee_qualifications')
      .select('*').eq('user_id', empId).eq('organization_id', orgId(req))
      .order('year_of_passing', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/profile/:id/education
const EDU_RULES = { from_year: V.pastYear('From year') };

router.post('/:id/education', auth, validateBody(EDU_RULES), async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    if (!isAdminRole(req.user.role) && parseInt(req.user.id) !== empId)
      return res.status(403).json({ error: 'Access denied' });
    const {
      degree_level, institution, board_university, specialization,
      from_year, to_year, year_of_passing, result_type,
      percentage, cgpa, degree_class, education_mode,
      education_country, enrollment_number, remarks,
    } = req.body;

    if (!institution) return res.status(400).json({ error: 'institution is required' });
    if (!/[a-zA-Z]/.test(institution)) return res.status(400).json({ error: 'Institution name must contain alphabetic characters.' });
    if (board_university && !/[a-zA-Z]/.test(board_university)) return res.status(400).json({ error: 'Board / University must contain at least one letter.' });
    if (specialization && !/[a-zA-Z]/.test(specialization)) return res.status(400).json({ error: 'Specialization must contain at least one letter.' });

    const currentYear = new Date().getFullYear();
    const fy = from_year ? Number(from_year) : null;
    const ty = to_year   ? Number(to_year)   : null;
    const yp = year_of_passing ? Number(year_of_passing) : null;

    if (fy && (fy < 1950 || fy > currentYear + 5)) return res.status(400).json({ error: `From Year must be between 1950 and ${currentYear + 5}.` });
    if (ty && (ty < 1950 || ty > currentYear + 5)) return res.status(400).json({ error: `To Year must be between 1950 and ${currentYear + 5}.` });
    if (fy && ty && ty < fy)  return res.status(400).json({ error: 'To Year cannot be before From Year.' });
    if (yp) {
      if (yp < 1950 || yp > currentYear)  return res.status(400).json({ error: `Year of Passing must be between 1950 and ${currentYear}.` });
      if (fy && yp < fy) return res.status(400).json({ error: 'Year of Passing cannot be before From Year.' });
      if (ty && yp > ty) return res.status(400).json({ error: 'Year of Passing cannot be after To Year.' });
    }
    if (percentage !== undefined && percentage !== null && percentage !== '' && (Number(percentage) < 0 || Number(percentage) > 100)) {
      return res.status(400).json({ error: 'Percentage must be between 0 and 100.' });
    }
    if (cgpa !== undefined && cgpa !== null && cgpa !== '' && (Number(cgpa) < 0 || Number(cgpa) > 10)) {
      return res.status(400).json({ error: 'CGPA must be between 0 and 10.' });
    }

    const { data, error } = await db.from('employee_qualifications').insert({
      user_id: empId, organization_id: orgId(req),
      degree_level:        degree_level        || null,
      institution,
      board_university:    board_university    || null,
      specialization:      specialization      || null,
      from_year: fy, to_year: ty, year_of_passing: yp,
      result_type:         result_type         || 'percentage',
      percentage:          percentage          || null,
      cgpa:                cgpa                || null,
      degree_class:        degree_class        || null,
      education_mode:      education_mode      || null,
      education_country:   education_country   || null,
      enrollment_number:   enrollment_number   || null,
      remarks:             remarks             || null,
      created_by: req.user.id,
      updated_at: new Date().toISOString(),
    }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/profile/:id/education/:recordId
router.put('/:id/education/:recordId', auth, validateBody(EDU_RULES), async (req, res) => {
  try {
    const empId    = parseInt(req.params.id);
    const recordId = parseInt(req.params.recordId);
    if (!isAdminRole(req.user.role) && parseInt(req.user.id) !== empId)
      return res.status(403).json({ error: 'Access denied' });
    const {
      degree_level, institution, board_university, specialization,
      from_year, to_year, year_of_passing, result_type,
      percentage, cgpa, degree_class, education_mode,
      education_country, enrollment_number, remarks,
    } = req.body;

    if (institution && !/[a-zA-Z]/.test(institution)) return res.status(400).json({ error: 'Institution name must contain letters.' });
    if (board_university && !/[a-zA-Z]/.test(board_university)) return res.status(400).json({ error: 'Board / University must contain at least one letter.' });
    if (specialization && !/[a-zA-Z]/.test(specialization)) return res.status(400).json({ error: 'Specialization must contain at least one letter.' });

    const currentYear = new Date().getFullYear();
    const fy = from_year ? Number(from_year) : null;
    const ty = to_year   ? Number(to_year)   : null;
    const yp = year_of_passing ? Number(year_of_passing) : null;

    if (fy && (fy < 1950 || fy > currentYear + 5)) return res.status(400).json({ error: `From Year must be between 1950 and ${currentYear + 5}.` });
    if (ty && (ty < 1950 || ty > currentYear + 5)) return res.status(400).json({ error: `To Year must be between 1950 and ${currentYear + 5}.` });
    if (fy && ty && ty < fy)  return res.status(400).json({ error: 'To Year cannot be before From Year.' });
    if (yp) {
      if (yp < 1950 || yp > currentYear)  return res.status(400).json({ error: `Year of Passing must be between 1950 and ${currentYear}.` });
      if (fy && yp < fy) return res.status(400).json({ error: 'Year of Passing cannot be before From Year.' });
      if (ty && yp > ty) return res.status(400).json({ error: 'Year of Passing cannot be after To Year.' });
    }
    if (percentage != null && percentage !== '' && (Number(percentage) < 0 || Number(percentage) > 100))
      return res.status(400).json({ error: 'Percentage must be between 0 and 100.' });
    if (cgpa != null && cgpa !== '' && (Number(cgpa) < 0 || Number(cgpa) > 10))
      return res.status(400).json({ error: 'CGPA must be between 0 and 10.' });

    const { data, error } = await db.from('employee_qualifications').update({
      degree_level:        degree_level        || null,
      institution:         institution         || null,
      board_university:    board_university    || null,
      specialization:      specialization      || null,
      from_year: fy, to_year: ty, year_of_passing: yp,
      result_type:         result_type         || 'percentage',
      percentage:          percentage          || null,
      cgpa:                cgpa                || null,
      degree_class:        degree_class        || null,
      education_mode:      education_mode      || null,
      education_country:   education_country   || null,
      enrollment_number:   enrollment_number   || null,
      remarks:             remarks             || null,
      updated_at: new Date().toISOString(), updated_by: req.user.id,
    }).eq('id', recordId).eq('user_id', empId).eq('organization_id', orgId(req)).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/profile/:id/education/:recordId
router.delete('/:id/education/:recordId', auth, async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    if (!isAdminRole(req.user.role) && parseInt(req.user.id) !== empId)
      return res.status(403).json({ error: 'Access denied' });
    const { error } = await db.from('employee_qualifications')
      .delete().eq('id', parseInt(req.params.recordId))
      .eq('user_id', empId).eq('organization_id', orgId(req));
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
