// Run an existing Express router's GET handler IN-PROCESS (no HTTP hop) and capture its JSON.
//
// Used by aggregate endpoints (e.g. /api/pending-approvals) so they reuse the exact RBAC guards, branch
// isolation and query logic of the endpoints they summarise — instead of re-implementing them. The
// dispatched request inherits the already-authenticated caller (req.user / branch headers), and every
// middleware of the target route (hasPermission, withBranchContext, ...) still runs.

const TIMEOUT_MS = 25000;

function dispatchGet(router, path, query, parentReq) {
  return new Promise((resolve) => {
    const qs = new URLSearchParams(query || {}).toString();
    // NB: req.path is a read-only getter derived from req.url, so only url/query/params are overridden.
    const req = Object.create(parentReq);
    Object.assign(req, {
      method: 'GET', url: path + (qs ? `?${qs}` : ''), originalUrl: parentReq.originalUrl,
      baseUrl: '', query: { ...(query || {}) }, params: {}, body: undefined,
    });
    let done = false;
    const finish = (status, body) => { if (!done) { done = true; clearTimeout(timer); resolve({ status, body }); } };
    const res = {
      statusCode: 200, locals: {}, headersSent: false,
      status(c) { this.statusCode = c; return this; },
      set() { return this; }, setHeader() { return this; }, header() { return this; }, getHeader() { return undefined; },
      json(b) { finish(this.statusCode, b); return this; },
      send(b) { finish(this.statusCode, b); return this; },
      sendStatus(c) { finish(c, null); return this; },
      end() { finish(this.statusCode, null); return this; },
    };
    const timer = setTimeout(() => finish(504, { error: 'timeout' }), TIMEOUT_MS);
    try {
      router.handle(req, res, (err) => finish(err ? 500 : 404, err ? { error: err.message } : null));
    } catch (err) { finish(500, { error: err.message }); }
  });
}

module.exports = { dispatchGet };
