// Optional, backward-compatible list parameters shared by the large list endpoints
// (GET /leaves, /regularization, /expenses).
//
// Contract: a request WITHOUT these params behaves exactly as before (full list, array response).
//   status = comma separated status list            e.g. ?status=pending,manager_approved
//   from / to = YYYY-MM-DD inclusive date bounds     (either may be given alone)
//   type = comma separated leave types               e.g. ?type=casual,sick                 (GET /leaves only)
//   view = list                                      compact rows: drops columns no screen reads (per endpoint, see LIST_VIEW_DROP)
//   limit (1..500) [+ page, 1-based]                 → at most `limit` rows; the response is still a plain array and
//                                                      X-Page / X-Limit / X-Has-More describe the slice
// None of these widen access: they are only ever applied AFTER the RBAC and branch filters of the endpoint.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_RE = /^[a-z][a-z_]{0,40}$/;
const TYPE_RE = /^[a-z][a-z0-9_]{0,40}$/;
const MAX_LIMIT = 500;

// Columns that no client screen reads (verified by searching the client source). `view=list` is OPT-IN: a request without it
// returns every column exactly as before, so other consumers are unaffected. Only the web list screens ask for it.
const LIST_VIEW_DROP = {
  leaves:         ['organization_id', 'google_event_id', 'deleted_at', 'dept_head_id', 'dept_head_reviewed_at', 'root_admin_id', 'root_admin_reviewed_at', 'approved_by', 'email'],
  regularization: ['organization_id', 'reviewed_by'],
  expenses:       ['organization_id', 'deleted_at', 'reviewed_by', 'manager_approved_at'],
};
function compactRows(rows, endpoint) {
  const drop = LIST_VIEW_DROP[endpoint] || [];
  return rows.map(r => { const c = { ...r }; for (const k of drop) delete c[k]; return c; });
}

class ListParamError extends Error {}

function parseStatusList(value) {
  if (value == null || value === '') return null;
  const list = String(value).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return null;
  if (list.length > 12 || list.some(s => !STATUS_RE.test(s))) throw new ListParamError('Invalid status filter.');
  return [...new Set(list)];
}

function parseDate(value, name) {
  if (value == null || value === '') return null;
  const v = String(value);
  if (!DATE_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new ListParamError(`Invalid ${name} date (use YYYY-MM-DD).`);
  return v;
}

function parseTypeList(value) {
  if (value == null || value === '') return null;
  const list = String(value).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return null;
  if (list.length > 20 || list.some(s => !TYPE_RE.test(s))) throw new ListParamError('Invalid type filter.');
  return [...new Set(list)];
}

function parseView(value) {
  if (value == null || value === '') return null;
  if (String(value) !== 'list') throw new ListParamError('Invalid view (use view=list).');
  return 'list';
}

/** @returns {{limit:number, page:number, offset:number} | null} null when the caller did not ask for paging */
function parsePaging(query) {
  if (query.limit == null || query.limit === '') return null;
  const limit = parseInt(query.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) throw new ListParamError('limit must be a positive integer.');
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  return { limit: Math.min(limit, MAX_LIMIT), page, offset: (page - 1) * Math.min(limit, MAX_LIMIT) };
}

function setPagingHeaders(res, paging, hasMore) {
  res.set({ 'X-Page': String(paging.page), 'X-Limit': String(paging.limit), 'X-Has-More': hasMore ? '1' : '0',
            'Access-Control-Expose-Headers': 'X-Page, X-Limit, X-Has-More' });
}

/** Parse all optional params at once; throws ListParamError (callers map it to HTTP 400). */
function parseListParams(query) {
  return {
    statuses: parseStatusList(query.status),
    types: parseTypeList(query.type),
    view: parseView(query.view),
    from: parseDate(query.from, 'from'),
    to: parseDate(query.to, 'to'),
    paging: parsePaging(query),
  };
}

module.exports = { parseListParams, parseStatusList, parseTypeList, parseView, parseDate, parsePaging, setPagingHeaders, compactRows, LIST_VIEW_DROP, ListParamError, MAX_LIMIT };
