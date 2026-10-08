const express = require('express');
const router  = express.Router();
const { V, validateBody } = require('../../utils/fieldValidators');
const { db }                      = require('../../config/db');
const { auth, isAdminRole, selfOrAdmin } = require('../../middleware/auth');
const { orgId }                         = require('../../utils/helpers');

const SELF_EDITABLE = [
  'phone', 'personal_email', 'nationality', 'religion', 'marital_status',
  'blood_group', 'height', 'weight', 'citizenship',
  'current_address_line1', 'current_address_line2', 'current_city',
  'current_state', 'current_country', 'current_postal_code',
  'permanent_address', 'permanent_city', 'permanent_state',
  'permanent_country', 'permanent_postal_code',
];

// GET /api/profile/:id/personal
router.get('/:id/personal', auth, async (req, res) => {
  try {
    const empId  = parseInt(req.params.id);
    const isSelf = parseInt(req.user.id) === empId;
    if (!isAdminRole(req.user.role) && !isSelf)
      return res.status(403).json({ error: 'Access denied' });

    const { data, error } = await db.from('users').select(`
      id, salutation, name, middle_name, surname, email, personal_email,
      phone, gender, date_of_birth, blood_group, marital_status,
      nationality, religion, citizenship, height, weight,
      current_address_line1, current_address_line2, current_city,
      current_state, current_country, current_postal_code,
      permanent_address, permanent_city, permanent_state,
      permanent_country, permanent_postal_code,
      profile_photo_url, avatar_color
    `).eq('id', empId).eq('organization_id', orgId(req)).maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Employee not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/profile/:id/personal
// Admins: full update. Employees: only SELF_EDITABLE fields.
router.put('/:id/personal', auth, selfOrAdmin(SELF_EDITABLE), validateBody({
  name: V.text('Full name'), middle_name: V.text('Middle name', { max: 50 }), surname: V.text('Surname', { max: 50 }),
  phone: V.phone('Mobile number'), personal_email: V.email('Personal email'), date_of_birth: V.pastDate('Date of birth'),
  nationality: V.text('Nationality', { max: 50 }), religion: V.text('Religion', { max: 50 }), citizenship: V.text('Citizenship', { max: 50 }),
  current_country: V.text('Country', { max: 60 }), permanent_country: V.text('Country', { max: 60 }),
}), async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    const isAdmin = isAdminRole(req.user.role);

    const allowed = isAdmin ? [
      'salutation', 'name', 'middle_name', 'surname', 'email', 'personal_email',
      'phone', 'gender', 'date_of_birth', 'blood_group', 'marital_status',
      'nationality', 'religion', 'citizenship', 'height', 'weight',
      'current_address_line1', 'current_address_line2', 'current_city',
      'current_state', 'current_country', 'current_postal_code',
      'permanent_address', 'permanent_city', 'permanent_state',
      'permanent_country', 'permanent_postal_code', 'profile_photo_url', 'avatar_color',
    ] : SELF_EDITABLE;

    const update = {};
    allowed.forEach(f => { if (f in req.body) update[f] = req.body[f] || null; });
    update.updated_at = new Date().toISOString();
    update.updated_by = req.user.id;

    const { data, error } = await db.from('users')
      .update(update).eq('id', empId).eq('organization_id', orgId(req)).select().single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
