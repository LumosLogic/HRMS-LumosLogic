'use strict';
// Password policy used by PUT /api/auth/change-password. Pure function, no database.
const assert = require('assert');
const { passwordPolicyError } = require('../utils/passwordPolicy');

const bad = {
  'Ab1!':                 /at least 8/,        // too short
  'abcdefg1!':            /uppercase/,
  'ABCDEFG1!':            /lowercase/,
  'Abcdefgh!':            /number/,
  'Abcdefg12':            /special/,
  '':                     /at least 8/,
};
for (const [pw, re] of Object.entries(bad)) assert.match(passwordPolicyError(pw) || '', re, `"${pw}" should fail: ${re}`);
for (const nonString of [undefined, null, 12345678, {}]) assert.ok(passwordPolicyError(nonString), 'non-string must be rejected');
for (const ok of ['Abcdef1!', 'Str0ng#Passw0rd', 'Aa1 bcdef']) assert.strictEqual(passwordPolicyError(ok), null, `"${ok}" should pass`);
console.log('password_policy: all checks passed');
