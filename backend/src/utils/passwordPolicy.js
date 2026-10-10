'use strict';

/**
 * Single password policy for user-chosen passwords. The browser shows the same rules, but the server is the one that
 * enforces them (a direct API call must not be able to set a weak password).
 *
 * @param {string} pw
 * @returns {string|null} the first rule that fails (user-facing message), or null when the password is acceptable
 */
function passwordPolicyError(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(pw))        return 'Password must contain at least one uppercase letter.';
  if (!/[a-z]/.test(pw))        return 'Password must contain at least one lowercase letter.';
  if (!/[0-9]/.test(pw))        return 'Password must contain at least one number.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password must contain at least one special character.';
  return null;
}

module.exports = { passwordPolicyError };
