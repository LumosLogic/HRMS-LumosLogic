const express = require('express');
const router  = express.Router();
const { db } = require('../../config/db');
const { auth, adminOnly } = require('../../middleware/auth');
const { orgId } = require('../../utils/helpers');
const gcal = require('../../services/googleCalendar');
const { withBranchContext } = require('../../middleware/branchContext');
const { resolveEmployeeIds } = require('../../utils/branchFilter');

// ─── Holidays CRUD ────────────────────────────────────────────────────────────
router.get('/holidays', auth, async (req, res) => {
  const { data } = await db.from('holidays').select('*').eq('organization_id', orgId(req)).order('date');
  res.json(data || []);
});

router.post('/holidays', auth, adminOnly, async (req, res) => {
  try {
    const { name, date, type, description, specific_msg } = req.body;
    if (!name || !date) return res.status(400).json({ error: 'Name and date required' });
    const { data, error } = await db.from('holidays').insert({ name, date, type: type||'public', description: description||'', specific_msg: specific_msg||null, organization_id: orgId(req) }).select().single();
    if (error) throw new Error(error.message);
    const gcalId = await gcal.createHolidayEvent(data);
    if (gcalId) await db.from('holidays').update({ google_event_id: gcalId }).eq('id', data.id);
    res.json({ ...data, google_event_id: gcalId || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/holidays/:id', auth, adminOnly, async (req, res) => {
  try {
    const { name, date, type, description, specific_msg } = req.body;
    const { data: existing } = await db.from('holidays').select('google_event_id').eq('id', req.params.id).maybeSingle();
    const { data } = await db.from('holidays').update({ name, date, type, description, specific_msg: specific_msg||null }).eq('id', req.params.id).select().single();
    if (existing?.google_event_id) gcal.updateHolidayEvent(existing.google_event_id, data);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/holidays/:id', auth, adminOnly, async (req, res) => {
  try {
    const { data: existing } = await db.from('holidays').select('google_event_id').eq('id', req.params.id).maybeSingle();
    if (existing?.google_event_id) gcal.deleteHolidayEvent(existing.google_event_id);
    await db.from('holidays').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Events CRUD ──────────────────────────────────────────────────────────────
router.get('/events', auth, async (req, res) => {
  const { data } = await db.from('events').select('*').eq('organization_id', orgId(req)).order('date');
  res.json(data || []);
});

router.post('/events', auth, adminOnly, async (req, res) => {
  try {
    const { title, date, end_date, description } = req.body;
    if (!title || !date) return res.status(400).json({ error: 'Title and date required' });
    const { data, error } = await db.from('events').insert({ title, date, end_date: end_date||null, description: description||'', created_by: req.user.id, organization_id: orgId(req) }).select().single();
    if (error) throw new Error(error.message);
    const gcalId = await gcal.createCompanyEvent(data);
    if (gcalId) await db.from('events').update({ google_event_id: gcalId }).eq('id', data.id);
    res.json({ ...data, google_event_id: gcalId || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/events/:id', auth, adminOnly, async (req, res) => {
  try {
    const { title, date, end_date, description } = req.body;
    const { data: existing } = await db.from('events').select('google_event_id').eq('id', req.params.id).maybeSingle();
    const { data } = await db.from('events').update({ title, date, end_date: end_date||null, description }).eq('id', req.params.id).select().single();
    if (existing?.google_event_id) gcal.updateCompanyEvent(existing.google_event_id, data);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/events/:id', auth, adminOnly, async (req, res) => {
  try {
    const { data: existing } = await db.from('events').select('google_event_id').eq('id', req.params.id).maybeSingle();
    if (existing?.google_event_id) gcal.deleteCompanyEvent(existing.google_event_id);
    await db.from('events').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Culture (Birthdays / Holidays / Events) ──────────────────────────────────
router.get('/culture', auth, withBranchContext, async (req, res) => {
  try {
    const { localDateStr } = require('../../utils/helpers');
    const today    = localDateStr();
    const todayMD  = today.slice(5); // MM-DD

    // Upcoming 30 days
    const future30 = new Date(); future30.setDate(future30.getDate() + 30);
    const f30Str   = localDateStr(future30);

    // BUG_059 / BUG_068: Birthdays from active employees only — exclude
    // inactive/resigned/terminated so they don't appear in the culture feed.
    // Branch isolation: when a branch is selected/accessible, only show employees
    // from that branch. resolveEmployeeIds returns null (org-wide) or an array.
    const accessibleIds = await resolveEmployeeIds(req.branchContext, orgId(req));

    let usersQuery = db.from('users')
      .select('id, name, avatar_color, department, date_of_birth')
      .eq('role', 'employee')
      .eq('organization_id', orgId(req))
      .not('employee_status', 'in', ['inactive', 'resigned', 'terminated']);

    if (accessibleIds !== null) {
      if (accessibleIds.length === 0) {
        return res.json({ birthdaysToday: [], upcomingBirthdays: [], holidays: [], events: [] });
      }
      usersQuery = usersQuery.in('id', accessibleIds);
    }

    const { data: users } = await usersQuery;

    const birthdaysToday    = (users || []).filter(u => u.date_of_birth && u.date_of_birth.slice(5) === todayMD);
    const upcomingBirthdays = [];
    for (let i = 1; i <= 30; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      const mm   = String(d.getMonth() + 1).padStart(2, '0');
      const dd   = String(d.getDate()).padStart(2, '0');
      const mmdd = `${mm}-${dd}`;
      const ds   = d.toISOString().split('T')[0];
      (users || []).filter(u => u.date_of_birth && u.date_of_birth.slice(5) === mmdd)
        .forEach(u => upcomingBirthdays.push({ ...u, birthday_date: ds, days_until: i }));
    }

    // Next upcoming holidays (no hard upper limit — show whatever is next)
    const [{ data: holidays }, { data: events }] = await Promise.all([
      db.from('holidays').select('*').eq('organization_id', orgId(req)).gte('date', today).order('date').limit(10),
      db.from('events').select('*').eq('organization_id', orgId(req)).gte('date', today).order('date').limit(10),
    ]);

    res.json({ birthdaysToday: birthdaysToday || [], upcomingBirthdays, holidays: holidays || [], events: events || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
