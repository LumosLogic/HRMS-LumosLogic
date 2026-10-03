/**
 * ids.js
 *
 * node-postgres returns BIGINT columns as STRINGS ('5'), while ids from the JWT / parseInt() are
 * NUMBERS (5). A strict `row.user_id !== req.user.id` is therefore ALWAYS true on a BIGINT schema:
 * owners get denied access to their own records (or 404 on their own organisation). Compare ids with
 * sameId(), which is correct for either representation.
 */
function sameId(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

module.exports = { sameId };
