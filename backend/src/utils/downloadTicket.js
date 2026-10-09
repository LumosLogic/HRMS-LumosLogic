/**
 * Download tickets — short-lived, single-use, single-resource links for file downloads that must be opened by
 * something that cannot send an Authorization header (the system browser / PDF viewer on a phone).
 *
 * Why not put the normal login token in the URL? A URL ends up in server access logs, proxy logs, the browser
 * history and the Referer header, and a 7-day session token there is a long-lived credential leak. A ticket is:
 *   - scoped      : valid for ONE purpose and ONE resource id only (cannot call any other API)
 *   - short-lived : expires in TTL_SECONDS
 *   - single-use  : its jti is burned the first time it is redeemed (replaying a leaked URL fails)
 *   - not a bearer for the account: redeeming it re-runs the full auth middleware (revocation, role changes, …)
 *
 * The in-memory burn list is per process (acceptable: tickets live ~60s; with several instances a ticket could be
 * redeemed once per instance inside its lifetime, which is still bounded by the scope + TTL above).
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const TTL_SECONDS = 60;
const burned = new Map(); // jti -> expiry (ms)

function secret() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set');
  return process.env.JWT_SECRET;
}

function sweep(now = Date.now()) {
  for (const [jti, exp] of burned) if (exp <= now) burned.delete(jti);
}

/** claims: the authenticated user's token claims (id, role, organization_id, …) the redeemed request will act as. */
function issueTicket({ purpose, resourceId, claims }) {
  if (!purpose || resourceId == null || !claims?.id) throw new Error('purpose, resourceId and claims are required');
  return jwt.sign(
    { typ: 'download-ticket', purpose, rid: String(resourceId), claims, jti: crypto.randomUUID() },
    secret(),
    { expiresIn: TTL_SECONDS },
  );
}

/** Verifies and burns the ticket. Returns the user claims, or throws Error with a safe, user-facing message. */
function redeemTicket(ticket, { purpose, resourceId }) {
  let d;
  try { d = jwt.verify(ticket, secret()); }
  catch { throw new Error('This download link has expired. Please try again.'); }
  if (d.typ !== 'download-ticket' || d.purpose !== purpose || d.rid !== String(resourceId))
    throw new Error('This download link is not valid for this file.');
  sweep();
  if (burned.has(d.jti)) throw new Error('This download link has already been used. Please try again.');
  burned.set(d.jti, (d.exp || 0) * 1000);
  return d.claims;
}

/**
 * Express middleware: if the request carries ?ticket=…, authenticate AS the ticket's user for this one request by
 * giving the normal `auth` middleware a freshly signed, very short-lived token (so every auth check still runs).
 * Requests without a ticket pass through untouched (normal Authorization header flow keeps working).
 */
function ticketAuth(purpose, idParam = 'id') {
  return (req, res, next) => {
    const ticket = req.query.ticket;
    if (!ticket) return next();
    try {
      const claims = redeemTicket(String(ticket), { purpose, resourceId: req.params[idParam] });
      req.headers.authorization = `Bearer ${jwt.sign(claims, secret(), { expiresIn: 30 })}`;
      delete req.query.token; // a ticket request never doubles as a query-token request
      next();
    } catch (e) {
      res.status(401).json({ error: e.message });
    }
  };
}

module.exports = { issueTicket, redeemTicket, ticketAuth, TTL_SECONDS, _burned: burned };
