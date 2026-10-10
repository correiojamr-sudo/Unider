const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./load-ts.cjs');
const { validAdultBirthDate, validNewPassword, validRegistrationName } = load('src/lib/registration.ts');

test('registration validates adult boundary in Lisbon, real dates, names and new passwords', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  assert.equal(validAdultBirthDate('2008-10-10', now), true);
  for (const value of ['2008-10-11', '2027-01-01', '1899-12-31', '2000-02-30', '2001-02-29', '', '2000-1-1']) assert.equal(validAdultBirthDate(value, now), false, value);
  assert.equal(validAdultBirthDate('2008-02-29', new Date('2026-02-28T12:00:00Z')), false);
  assert.equal(validAdultBirthDate('2008-02-29', new Date('2026-03-01T12:00:00Z')), true);
  assert.equal(validAdultBirthDate('2008-10-11', new Date('2026-10-10T23:30:00Z')), true);
  assert.equal(validRegistrationName(' João '), true);
  for (const value of ['', '   ', 'a'.repeat(81), 'a\nb']) assert.equal(validRegistrationName(value), false);
  assert.equal(validNewPassword('123456789012'), true);
  assert.equal(validNewPassword('a'.repeat(128)), true);
  assert.equal(validNewPassword('short'), false);
  assert.equal(validNewPassword('a'.repeat(129)), false);
});
