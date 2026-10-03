// Optional, backward-compatible list parameters shared by the large list endpoints
// (GET /leaves, /regularization, /expenses).
//
// Contract: a request WITHOUT these params behaves exactly as before (full list, array response).
//   status = comma separated status list            e.g. ?status=pending,manager_approved
//   from / to = YYYY-MM-DD inclusive date bounds     (either may be given alone)
//   limit (1..500) [+ page, 1-based]                 → at most `limit` rows; the response is still a plain array and
//                                                      X-Page / X-Limit / X-Has-More describe the slice
// None of these widen access: they are only ever applied AFTER the RBAC and branch filters of the endpoint.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_RE = /^[a-z][a-z_]{0,40}$/;
const MAX_LIMIT = 500;

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
    from: parseDate(query.from, 'from'),
    to: parseDate(query.to, 'to'),
    paging: parsePaging(query),
  };
}

module.exports = { parseListParams, parseStatusList, parseDate, parsePaging, setPagingHeaders, ListParamError, MAX_LIMIT };
