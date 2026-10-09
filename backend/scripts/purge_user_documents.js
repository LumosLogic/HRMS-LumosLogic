/**
 * Permanently delete the uploaded documents of specific employees — from Cloudinary AND the database.
 *
 *   DRY RUN (default, changes nothing):  node scripts/purge_user_documents.js --user-ids 12,34
 *   DELETE FOR REAL:                     node scripts/purge_user_documents.js --user-ids 12,34 --apply
 *
 * Covers: employee_doc_submissions (Verification Queue uploads) and employee_documents (+ their document_shares).
 * NOT touched: users, bgv_requests, doc_submission_activity (audit log), anything else.
 * A DB row is deleted only after its Cloudinary file is gone (or Cloudinary says it never existed), so a
 * Cloudinary failure leaves that row in place and the script can simply be re-run. IRREVERSIBLE with --apply.
 * Targets are numeric user ids only (never names) so the wrong person cannot be matched by accident.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../src/config/db');
const cloudinary = require('../src/config/cloudinary');

const apply = process.argv.includes('--apply');
const idArg = process.argv[process.argv.indexOf('--user-ids') + 1];
const userIds = (process.argv.includes('--user-ids') && idArg ? idArg.split(',') : []).map(x => x.trim());
if (!userIds.length || !userIds.every(x => /^\d+$/.test(x))) {
  console.error('Usage: node scripts/purge_user_documents.js --user-ids 12,34 [--apply]   (numeric user ids only)');
  process.exit(1);
}

// https://res.cloudinary.com/<cloud>/<image|raw|video>/upload/[v123/]<public_id>[.ext]
function parseCloudinaryUrl(url, storedPublicId) {
  const m = String(url || '').match(/^https:\/\/res\.cloudinary\.com\/[^/]+\/(image|raw|video)\/upload\/(?:v\d+\/)?(.+)$/);
  if (!m) return null;
  const resource_type = m[1];
  const full = decodeURIComponent(m[2].split('?')[0]);
  // images/videos: public id has no extension; raw files keep it.
  const derived = resource_type === 'raw' ? full : full.replace(/\.[^./]+$/, '');
  return { resource_type, public_id: storedPublicId || derived };
}

async function destroy(url, storedPublicId) {
  const p = parseCloudinaryUrl(url, storedPublicId);
  if (!p) return { ok: false, why: 'not a Cloudinary URL' };
  const r = await cloudinary.uploader.destroy(p.public_id, { resource_type: p.resource_type, invalidate: true });
  if (r.result === 'ok' || r.result === 'not found') return { ok: true, result: r.result, ...p };
  return { ok: false, why: r.result, ...p };
}

(async () => {
  console.log(apply ? '*** APPLY MODE — deleting for real ***' : 'DRY RUN — nothing will be changed (add --apply to delete)');
  const { rows: users } = await pool.query('SELECT id, name, email, organization_id FROM users WHERE id = ANY($1::bigint[])', [userIds]);
  const found = new Set(users.map(u => String(u.id)));
  for (const id of userIds) if (!found.has(id)) console.log(`! user id ${id} does not exist`);
  let failures = 0;

  for (const u of users) {
    console.log(`\n== ${u.name} <${u.email}> (user ${u.id}, org ${u.organization_id}) ==`);
    const { rows: subs } = await pool.query(
      `SELECT s.id, r.name AS requirement, s.status, s.file_url, s.cloudinary_public_id
         FROM employee_doc_submissions s JOIN document_requirements r ON r.id = s.requirement_id
        WHERE s.user_id = $1 AND s.organization_id = $2 ORDER BY s.id`, [u.id, u.organization_id]);
    const { rows: docs } = await pool.query(
      `SELECT id, name, file_url FROM employee_documents WHERE user_id = $1 AND organization_id = $2 ORDER BY id`, [u.id, u.organization_id]);
    console.log(`  verification-queue submissions: ${subs.length}, shared/personal documents: ${docs.length}`);
    subs.forEach(s => console.log(`   - submission #${s.id}  ${s.requirement}  [${s.status}]`));
    docs.forEach(d => console.log(`   - document   #${d.id}  ${d.name}`));
    if (!apply) continue;

    for (const s of subs) {
      const r = await destroy(s.file_url, s.cloudinary_public_id);
      if (!r.ok) { failures++; console.log(`   ! submission #${s.id}: Cloudinary NOT deleted (${r.why}) — row kept`); continue; }
      await pool.query('DELETE FROM employee_doc_submissions WHERE id = $1', [s.id]);
      console.log(`   x submission #${s.id} deleted (cloudinary: ${r.result})`);
    }
    for (const d of docs) {
      const r = await destroy(d.file_url, null);
      if (!r.ok) { failures++; console.log(`   ! document #${d.id}: Cloudinary NOT deleted (${r.why}) — row kept`); continue; }
      await pool.query('DELETE FROM document_shares WHERE document_id = $1', [d.id]);
      await pool.query('DELETE FROM employee_documents WHERE id = $1', [d.id]);
      console.log(`   x document #${d.id} deleted (cloudinary: ${r.result})`);
    }
  }
  console.log(apply ? `\nDone. ${failures} item(s) could not be removed from Cloudinary and were left in place.` : '\nDry run finished.');
  await pool.end();
  process.exit(failures ? 2 : 0);
})().catch(async (e) => { console.error('FATAL', e.message); try { await pool.end(); } catch {} process.exit(1); });
