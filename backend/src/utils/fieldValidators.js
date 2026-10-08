'use strict';
// Shared server-side field validators for employee data (EMP-xxx validation bugs in the QA sheets).
//
// Use as route middleware:   router.put('/:id/x', auth, validateBody({ phone: V.phone('Mobile number') }), handler)
// Rules only run on fields that are PRESENT and NON-EMPTY in the body, so clearing a field and partial updates are
// unaffected. A failing rule answers 400 { error, field } with a message naming the field.
//
// The formats used are the public ones (Aadhaar 12 digits, PAN AAAAA9999A, IFSC AAAA0AAAAAA, UAN 12 digits,
// ESIC IP number 17 digits, phone 7-15 digits). Anything that would be a company policy is NOT decided here.

const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const str = (v) => String(v).trim();

const todayStr = () => new Date().toISOString().slice(0, 10);
const validYmd = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = s.slice(0, 10);
  const dt = new Date(d + 'T00:00:00Z');
  return !isNaN(dt) && dt.toISOString().slice(0, 10) === d ? d : null;
};

const V = {
  /** Free text that must read as text: at least one letter (rejects "123" and "@@@"), length-limited. */
  text: (label, { min = 1, max = 100 } = {}) => (v) => {
    const s = str(v);
    if (s.length < min) return `${label} must be at least ${min} characters.`;
    if (s.length > max) return `${label} must be ${max} characters or fewer.`;
    if (!/\p{L}/u.test(s)) return `${label} must contain letters, not only numbers or special characters.`;
    return null;
  },
  /** Phone: optional leading +, then 7-15 digits; spaces, dashes, dots and brackets are tolerated. No letters. */
  phone: (label) => (v) => {
    const s = str(v);
    if (/\p{L}/u.test(s) || !/^\+?[\d\s\-().]+$/.test(s)) return `${label} may contain only digits (and + - ( ) separators).`;
    const digits = s.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return `${label} must have 7 to 15 digits.`;
    return null;
  },
  email: (label) => (v) => {
    const s = str(v);
    return s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? null : `${label} is not a valid email address.`;
  },
  /** Date that must be a real calendar date and not in the future. */
  pastDate: (label) => (v) => {
    const d = validYmd(str(v));
    if (!d) return `${label} must be a valid date (YYYY-MM-DD).`;
    if (d > todayStr()) return `${label} cannot be in the future.`;
    if (d < '1900-01-01') return `${label} is not a valid date.`;
    return null;
  },
  /** Four-digit year that is not in the future. */
  pastYear: (label) => (v) => {
    const y = Number(str(v));
    if (!Number.isInteger(y) || y < 1900) return `${label} must be a valid year.`;
    if (y > new Date().getFullYear()) return `${label} cannot be in the future.`;
    return null;
  },
  /** Fixed-length digit string (spaces/dashes ignored). */
  digits: (label, len) => (v) => {
    const s = str(v).replace(/[\s-]/g, '');
    if (!/^\d+$/.test(s)) return `${label} must contain digits only.`;
    return s.length === len ? null : `${label} must be exactly ${len} digits.`;
  },
  digitsRange: (label, min, max) => (v) => {
    const s = str(v).replace(/[\s-]/g, '');
    if (!/^\d+$/.test(s)) return `${label} must contain digits only.`;
    return s.length >= min && s.length <= max ? null : `${label} must be ${min} to ${max} digits.`;
  },
  pan: (label = 'PAN number') => (v) => /^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(str(v)) ? null : `${label} must be in the format AAAAA9999A.`,
  ifsc: (label = 'IFSC code') => (v) => /^[A-Z]{4}0[A-Z0-9]{6}$/i.test(str(v)) ? null : `${label} must be 11 characters in the format AAAA0XXXXXX.`,
  /** PF account numbers vary by region, so only the character set and a sane length are enforced. */
  pfNumber: (label = 'PF number') => (v) => {
    const s = str(v);
    if (!/^[A-Za-z0-9/\-. ]+$/.test(s)) return `${label} may contain only letters, digits and / - .`;
    return s.length >= 5 && s.length <= 30 ? null : `${label} must be 5 to 30 characters.`;
  },
  nonNegativeInt: (label, max = 120) => (v) => {
    const n = Number(str(v));
    if (!Number.isInteger(n)) return `${label} must be a whole number.`;
    if (n < 0) return `${label} cannot be negative.`;
    return n <= max ? null : `${label} cannot be more than ${max}.`;
  },
};

/** Returns the first error message for `body` against `rules` ({ field: (value, body) => msg|null }), or null. */
function firstError(body, rules) {
  if (!body || typeof body !== 'object') return null;
  for (const [field, rule] of Object.entries(rules)) {
    if (!(field in body) || isBlank(body[field])) continue;
    const msg = rule(body[field], body);
    if (msg) return { field, error: msg };
  }
  return null;
}

function validateBody(rules) {
  return (req, res, next) => {
    const bad = firstError(req.body, rules);
    return bad ? res.status(400).json(bad) : next();
  };
}

module.exports = { V, validateBody, firstError, isBlank };
