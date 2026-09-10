/**
 * Run: node --experimental-default-type=module utils/shiftMatching.test.js
 */
import assert from 'node:assert/strict';
import { ShiftMatching, shiftRowMatchesEmployee, formatLocalDateYMD } from './shiftMatching.js';

function test(name, fn) {
  fn();
  console.log('ok', name);
}

test('dateKey keeps DATE strings and strips ISO time', () => {
  assert.equal(ShiftMatching.dateKey('2026-09-15'), '2026-09-15');
  assert.equal(ShiftMatching.dateKey('2026-09-15T00:00:00.000Z'), '2026-09-15');
  assert.equal(ShiftMatching.dateKey('2026-09-15T05:00:00+00:00'), '2026-09-15');
});

test('formatLocalDateYMD matches local calendar date', () => {
  const d = new Date(2026, 8, 10);
  assert.equal(formatLocalDateYMD(d), '2026-09-10');
});

test('hyphen slug from web Assign Shift matches "First Last"', () => {
  const row = { employee_name: 'Kenny-bae', employee_id: null };
  assert.equal(shiftRowMatchesEmployee(row, null, ['Kenny Bae'], null), true);
  assert.equal(
    ShiftMatching.rowMatchesEmployee(row, 'profile-uuid', ['klb10012004', 'Kenny Bae'], 'auth-uuid'),
    true
  );
});

test('canonical username matches when org profile aliases include display name', () => {
  const row = { employee_name: 'Kenny Bae', employee_id: null };
  const aliases = ShiftMatching.collectNameCandidates(
    { employeeName: 'klb10012004', email: 'klb10012004@example.com', employeeId: 'p1', authUserId: 'u1' },
    [
      {
        id: 'p1',
        user_id: 'u1',
        employee_name: 'klb10012004',
        display_name: 'Kenny Bae',
        first_name: 'Kenny',
        last_name: 'Bae',
        email: 'klb10012004@example.com',
      },
    ]
  );
  assert.ok(aliases.includes('Kenny Bae'));
  assert.equal(ShiftMatching.rowMatchesEmployee(row, 'p1', aliases, 'u1'), true);
});

test('employee_id match on profiles.id still wins', () => {
  const row = { employee_name: 'Someone Else', employee_id: 'p1' };
  assert.equal(
    ShiftMatching.rowMatchesEmployee(row, 'p1', ['Test User'], 'u1'),
    true
  );
});

test('knownProfileIds matches when context employeeId was stale', () => {
  const row = { employee_name: 'x', employee_id: 'profile-real' };
  const ids = new Set(['profile-real']);
  assert.equal(
    ShiftMatching.rowMatchesEmployee(row, 'stale-id', ['nope'], 'auth', ids),
    true
  );
});

test('unrelated coworker is not matched', () => {
  const row = { employee_name: 'Rohan Kumar', employee_id: 'other' };
  assert.equal(
    ShiftMatching.rowMatchesEmployee(row, 'p1', ['Kenny Bae', 'klb10012004'], 'u1'),
    false
  );
});

test('compact key treats dots like spaces', () => {
  const row = { employee_name: 'test.user', employee_id: null };
  assert.equal(shiftRowMatchesEmployee(row, null, ['Test User'], null), true);
});

console.log('\nAll shiftMatching tests passed.');
