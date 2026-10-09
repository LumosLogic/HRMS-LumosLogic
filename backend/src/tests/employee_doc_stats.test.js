/**
 * employee_doc_stats.test.js — the employee "My Documents" cards and lists (client/src/lib/employeeDocStats.js).
 * Includes the Relitrade case from the QA screenshots: 4 required (all approved) + 7 optional (3 approved, 4 not uploaded)
 * used to read "4 Total Required / 7 Approved" with the 3 approved optional documents listed twice.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { pathToFileURL } = require('url');

const CLIENT = path.join(__dirname, '../../../client/src');
let passed = 0, failed = 0; const failures = [];
async function t(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${String(e.message).split('\n').filter(Boolean).slice(0, 6).join('\n    ')}`); failed++; failures.push(name); }
}
const req = (id, name, is_required, status = null) => ({ id, name, is_required, _submission: status ? { id: id * 10, status } : null });

(async () => {
  const { employeeDocStats } = await import(pathToFileURL(path.join(CLIENT, 'lib/employeeDocStats.js')).href);

  console.log('\nEMPLOYEE DOCUMENT CARDS');
  await t('Relitrade employee: 4 required all approved → cards 4 / 4 / 0 / 0 / 0, ring 100%; the 3 approved optional documents are NOT counted as approved', () => {
    const list = [
      req(1, 'Aadhaar Card', true, 'approved'), req(2, 'Bank Passbook', true, 'approved'), req(3, 'Employee Photo', true, 'approved'), req(4, 'PAN Card', true, 'approved'),
      req(5, 'Driving License', false), req(6, 'Medical Certificate', false), req(7, 'Passport', false), req(8, 'Ration Card', false),
      req(9, 'Birth Certificate', false, 'approved'), req(10, 'TDS Form', false, 'approved'), req(11, 'Voter ID', false, 'approved'),
    ];
    const s = employeeDocStats(list);
    assert.deepStrictEqual([s.totalRequired, s.approved, s.underReview, s.reuploadRequested, s.notUploaded, s.progressPct], [4, 4, 0, 0, 0, 100]);
    assert.deepStrictEqual(s.optionalPending.map(r => r.name), ['Driving License', 'Medical Certificate', 'Passport', 'Ration Card']);
    assert.strictEqual(s.uploaded.length, 7, 'My Submitted Documents still lists all 7 uploads');
    assert.strictEqual(s.optionalTotal, 7, '7 optional documents exist: 4 still to upload + 3 already in Submitted');
    assert.strictEqual(s.totalRequired + s.optionalTotal, 11, 'all 11 documents are accounted for');
    assert.strictEqual(s.actionRequired.length, 0);
  });
  await t('the five cards always add up to Total Required (every required document is in exactly one state)', () => {
    const list = [
      req(1, 'A', true, 'approved'), req(2, 'B', true, 'under_review'), req(3, 'C', true, 're_upload_requested'), req(4, 'D', true, 'rejected'), req(5, 'E', true),
      req(6, 'Opt approved', false, 'approved'), req(7, 'Opt review', false, 'under_review'), req(8, 'Opt none', false),
    ];
    const s = employeeDocStats(list);
    assert.strictEqual(s.totalRequired, 5);
    assert.strictEqual(s.approved + s.underReview + s.reuploadRequested + s.rejected + s.notUploaded, s.totalRequired);
    assert.strictEqual(s.progressPct, 20);
  });
  await t('an optional document is never listed twice: uploaded → Submitted only; rejected / re-upload requested → Action Required (not the Optional list); missing → Optional list only', () => {
    const list = [req(1, 'Up', false, 'approved'), req(2, 'Rej', false, 'rejected'), req(3, 'Re', false, 're_upload_requested'), req(4, 'None', false), req(5, 'Review', false, 'under_review')];
    const s = employeeDocStats(list);
    assert.deepStrictEqual(s.optionalPending.map(r => r.name), ['None']);
    assert.deepStrictEqual(s.actionRequired.map(r => r.name).sort(), ['Re', 'Rej']);
    assert.deepStrictEqual(s.uploaded.map(r => r.name), ['Up', 'Rej', 'Re', 'Review']);
    // no document is in the Optional list AND in another list
    const opt = new Set(s.optionalPending.map(r => r.id));
    assert.ok(![...s.uploaded, ...s.actionRequired].some(r => opt.has(r.id)));
  });
  await t('a required document that is missing is "Action Required" and counted Not Uploaded; HR switching it to Optional moves it to the Optional list and out of the required cards', () => {
    const asRequired = employeeDocStats([req(1, 'Passport', true), req(2, 'PAN', true, 'approved')]);
    assert.deepStrictEqual([asRequired.totalRequired, asRequired.notUploaded, asRequired.progressPct, asRequired.actionRequired.length], [2, 1, 50, 1]);
    const asOptional = employeeDocStats([req(1, 'Passport', false), req(2, 'PAN', true, 'approved')]);
    assert.deepStrictEqual([asOptional.totalRequired, asOptional.notUploaded, asOptional.progressPct, asOptional.actionRequired.length], [1, 0, 100, 0]);
    assert.deepStrictEqual(asOptional.optionalPending.map(r => r.name), ['Passport']);
  });
  await t('empty / missing input is safe (no requirements → zeros, 0%)', () => {
    for (const input of [[], undefined, null]) {
      const s = employeeDocStats(input);
      assert.deepStrictEqual([s.totalRequired, s.approved, s.progressPct, s.optionalPending.length, s.uploaded.length], [0, 0, 0, 0, 0]);
    }
  });

  console.log('\nMY DOCUMENTS PAGE (source)');
  const page = fs.readFileSync(path.join(CLIENT, 'pages/Documents.jsx'), 'utf8').replace(/\r\n/g, '\n');
  const emp = page.slice(page.indexOf('// Compute stats') > -1 ? page.indexOf('// Cards / lists come from one tested helper') : 0);
  await t('the page builds its cards and lists from the tested helper, and the Optional list is the not-uploaded list', () => {
    assert.match(page, /import \{ employeeDocStats \} from '@\/lib\/employeeDocStats'/);
    assert.match(emp, /employeeDocStats\(requirements\)/);
    assert.match(emp, /optionalPending\.length > 0 &&/);
    assert.match(emp, /optionalPending\.map\(req =>/);
    assert.doesNotMatch(emp, /requirements\.filter\(r => !r\.is_required\)\.map/, 'the old list (all optional documents, uploaded ones included) is gone');
  });

  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILED:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('\n✅  All employee document display checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
