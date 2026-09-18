/**
 * Run: node --experimental-default-type=module utils/taskQueries.test.js
 */
import assert from 'node:assert/strict';
import {
  HOME_URGENT_LIMIT,
  MY_TASKS_LIMIT,
  TASK_LIST_COLUMNS,
  escapeOrValue,
  mineTasksOrFilter,
  taskNameQueryVariants,
} from './taskQueries.js';

function test(name, fn) {
  fn();
  console.log('ok', name);
}

test('list columns are explicit (no star)', () => {
  assert.equal(TASK_LIST_COLUMNS.includes('*'), false);
  assert.ok(TASK_LIST_COLUMNS.includes('employee_id'));
  assert.ok(TASK_LIST_COLUMNS.includes('employee_name'));
  assert.ok(MY_TASKS_LIMIT <= 200);
  assert.ok(HOME_URGENT_LIMIT <= 20);
});

test('name variants cover hyphen slugs from web assign', () => {
  const v = taskNameQueryVariants(['Kenny Bae', 'klb10012004']);
  assert.ok(v.includes('Kenny Bae'));
  assert.ok(v.includes('Kenny-Bae') || v.includes('Kenny-bae'));
  assert.ok(v.includes('klb10012004'));
});

test('or filter is employee-scoped, not org-wide', () => {
  const or = mineTasksOrFilter(['profile-uuid', 'auth-uuid'], ['Kenny Bae']);
  assert.ok(or.includes('employee_id.eq.profile-uuid'));
  assert.ok(or.includes('employee_id.eq.auth-uuid'));
  assert.ok(or.includes('employee_name.ilike."Kenny Bae"'));
  assert.equal(or.includes('org_id'), false);
});

test('empty identity yields empty filter (caller must not select all)', () => {
  assert.equal(mineTasksOrFilter([], []), '');
  assert.equal(mineTasksOrFilter(null, null), '');
});

test('escape strips or-clause breakers', () => {
  assert.equal(escapeOrValue('Kenny, Bae (AM)'), 'Kenny Bae AM');
});

console.log('\nAll taskQueries tests passed.');
