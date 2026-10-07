/**
 * purge_cloudinary_org.js — companion to migrations/purge_organization.sql
 *
 * Deletes every Cloudinary file uploaded under  hrms/<org_id>/  EXCEPT:
 *   - hrms/<org_id>/org/…            (org logo)
 *   - the root_admin users' avatar   (matched via users.avatar_url)
 *   - the org's logo_url             (matched via organizations.logo_url)
 *
 * Works before or after the SQL purge (it is prefix-based, not row-based).
 * DRY RUN by default — nothing is deleted unless --confirm is passed.
 *
 * USAGE (from repo root, with the same .env the app uses):
 *   node backend/scripts/purge_cloudinary_org.js test-lumos-logic            # dry run
 *   node backend/scripts/purge_cloudinary_org.js test-lumos-logic --confirm  # delete
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { Pool } = require('pg');
const cloudinary = require('cloudinary').v2;

const slug    = process.argv[2];
const CONFIRM = process.argv.includes('--confirm');
const TYPES   = ['image', 'raw', 'video'];

if (!slug || slug.startsWith('--')) {
  console.error('Usage: node backend/scripts/purge_cloudinary_org.js <org-slug> [--confirm]');
  process.exit(1);
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'lumos_hrms',
  user:     process.env.DB_USER     || 'lumos_admin',
  password: process.env.DB_PASSWORD,
});

// https://res.cloudinary.com/<cloud>/<type>/upload/[transforms/]v123/hrms/1/x/file.pdf -> hrms/1/x/file
function publicIdFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/\/upload\/(?:[^/]+\/)*?(?:v\d+\/)?(hrms\/.+?)(?:\.[A-Za-z0-9]+)?(?:\?.*)?$/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function listAll(prefix, resource_type) {
  const out = [];
  let next_cursor;
  do {
    const r = await cloudinary.api.resources({ type: 'upload', prefix, resource_type, max_results: 500, next_cursor });
    out.push(...r.resources.map(x => x.public_id));
    next_cursor = r.next_cursor;
  } while (next_cursor);
  return out;
}

(async () => {
  const { rows: orgs } = await pool.query('SELECT id, logo_url FROM organizations WHERE slug = $1', [slug]);
  if (!orgs.length) throw new Error(`Organization '${slug}' not found`);
  const orgId = orgs[0].id;
  const prefix = `hrms/${orgId}/`;

  const { rows: roots } = await pool.query(
    `SELECT avatar_url FROM users WHERE organization_id = $1 AND role = 'root_admin'`, [orgId]);
  const keep = new Set([orgs[0].logo_url, ...roots.map(r => r.avatar_url)]
    .map(publicIdFromUrl).filter(Boolean));

  console.log(`Org id=${orgId}  prefix=${prefix}  mode=${CONFIRM ? 'DELETE' : 'DRY RUN'}`);
  console.log(`Keeping: ${keep.size ? [...keep].join(', ') : '(no avatar/logo matched)'} + ${prefix}org/*`);

  let total = 0;
  for (const type of TYPES) {
    const ids = (await listAll(prefix, type))
      .filter(id => !id.startsWith(`${prefix}org/`) && !keep.has(id));
    console.log(`[${type}] ${ids.length} file(s) to delete`);
    ids.slice(0, 10).forEach(id => console.log('   ', id));
    if (ids.length > 10) console.log(`    … and ${ids.length - 10} more`);
    total += ids.length;

    if (CONFIRM) {
      for (let i = 0; i < ids.length; i += 100) {   // Admin API limit: 100 per call
        await cloudinary.api.delete_resources(ids.slice(i, i + 100), { resource_type: type, type: 'upload', invalidate: true });
      }
    }
  }
  console.log(CONFIRM ? `Deleted ${total} file(s).` : `Dry run: ${total} file(s) would be deleted. Re-run with --confirm.`);
})()
  .catch(e => { console.error('FAILED:', e.message || e); process.exitCode = 1; })
  .finally(() => pool.end());
