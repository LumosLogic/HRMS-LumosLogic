// Download tickets: scoped, short-lived, single-use. Pure unit test (no DB).
// Run: node src/tests/download_ticket.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-download-tickets';
const assert = require('assert');
const jwt = require('jsonwebtoken');
const { issueTicket, redeemTicket, ticketAuth, _burned } = require('../utils/downloadTicket');

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n     ', String(e.message).split('\n')[0]); } };
const claims = { id: 7, email: 'a@b.co', role: 'employee', name: 'A', organization_id: 1, organization_slug: 'x' };
const mk = (over = {}) => issueTicket({ purpose: 'payslip-pdf', resourceId: 42, claims, ...over });

t('a valid ticket returns the user claims', () => {
  assert.deepStrictEqual(redeemTicket(mk(), { purpose: 'payslip-pdf', resourceId: 42 }), claims);
});
t('is single-use: the second redeem is rejected', () => {
  const tk = mk();
  redeemTicket(tk, { purpose: 'payslip-pdf', resourceId: 42 });
  assert.throws(() => redeemTicket(tk, { purpose: 'payslip-pdf', resourceId: 42 }), /already been used/);
});
t('is scoped to one resource id', () => {
  assert.throws(() => redeemTicket(mk(), { purpose: 'payslip-pdf', resourceId: 43 }), /not valid for this file/);
});
t('is scoped to one purpose', () => {
  assert.throws(() => redeemTicket(mk(), { purpose: 'other', resourceId: 42 }), /not valid for this file/);
});
t('expired tickets are rejected', () => {
  const old = jwt.sign({ typ: 'download-ticket', purpose: 'payslip-pdf', rid: '42', claims, jti: 'x1' }, process.env.JWT_SECRET, { expiresIn: -5 });
  assert.throws(() => redeemTicket(old, { purpose: 'payslip-pdf', resourceId: 42 }), /expired/);
});
t('a normal login token is NOT a valid ticket', () => {
  const login = jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: '7d' });
  assert.throws(() => redeemTicket(login, { purpose: 'payslip-pdf', resourceId: 42 }), /not valid/);
});
t('a tampered ticket is rejected', () => {
  const tk = mk();
  assert.throws(() => redeemTicket(tk.slice(0, -2) + 'xx', { purpose: 'payslip-pdf', resourceId: 42 }), /expired|valid/);
});
t('issuing requires purpose, resource and a user', () => {
  assert.throws(() => issueTicket({ purpose: 'p', resourceId: 1, claims: {} }));
});
t('middleware: no ticket → passes through untouched', () => {
  const req = { query: {}, params: { id: '42' }, headers: {} };
  let called = false;
  ticketAuth('payslip-pdf')(req, {}, () => { called = true; });
  assert.ok(called && !req.headers.authorization);
});
t('middleware: valid ticket → short-lived bearer for that user, then burned', () => {
  const req = { query: { ticket: mk(), token: 'sneaky' }, params: { id: '42' }, headers: {} };
  let called = false;
  ticketAuth('payslip-pdf')(req, {}, () => { called = true; });
  assert.ok(called);
  const d = jwt.verify(req.headers.authorization.split(' ')[1], process.env.JWT_SECRET);
  assert.strictEqual(d.id, 7);
  assert.ok(d.exp - d.iat <= 30);
  assert.strictEqual(req.query.token, undefined);
  assert.ok(_burned.size > 0);
});
t('middleware: wrong id → 401, next not called', () => {
  const req = { query: { ticket: mk() }, params: { id: '99' }, headers: {} };
  let status = 0, called = false;
  const res = { status(s) { status = s; return this; }, json() {} };
  ticketAuth('payslip-pdf')(req, res, () => { called = true; });
  assert.strictEqual(status, 401);
  assert.ok(!called);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
