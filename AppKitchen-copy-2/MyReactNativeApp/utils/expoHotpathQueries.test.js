/**
 * Run: node --experimental-default-type=module utils/expoHotpathQueries.test.js
 */
import assert from 'node:assert/strict';
import {
  TASK_LIST_COLUMNS,
  TASK_LIST_LIMIT,
  URGENT_TASK_COLUMNS,
  URGENT_TASK_LIMIT,
  SHIFT_CARD_COLUMNS,
  TODAY_SHIFT_LIMIT,
  UPCOMING_SHIFT_LIMIT,
  employeeOrFilter,
  nameMatchVariants,
  taskIsCompleted,
} from './expoHotpathQueries.js';

function test(name, fn) {
  fn();
  console.log('ok', name);
}

test('task and shift selects list columns and stay bounded', () => {
  for (const cols of [TASK_LIST_COLUMNS, URGENT_TASK_COLUMNS, SHIFT_CARD_COLUMNS]) {
    assert.equal(cols.includes('*'), false);
    assert.equal(cols.includes('employee_id'), true);
    assert.equal(cols.includes('employee_name'), true);
  }
  assert.ok(TASK_LIST_LIMIT > 0 && TASK_LIST_LIMIT <= 200);
  assert.ok(URGENT_TASK_LIMIT > 0 && URGENT_TASK_LIMIT <= 20);
  assert.ok(TODAY_SHIFT_LIMIT > 0 && TODAY_SHIFT_LIMIT <= 10);
  assert.ok(UPCOMING_SHIFT_LIMIT > 0 && UPCOMING_SHIFT_LIMIT <= 20);
  assert.equal(SHIFT_CARD_COLUMNS.includes('position'), true);
  assert.equal(TASK_LIST_COLUMNS.includes('shift_id'), true);
});

test('name variants include the web hyphen slug', () => {
  const variants = nameMatchVariants('Kenny Bae').map((v) => v.toLowerCase());
  assert.ok(variants.includes('kenny bae'));
  assert.ok(variants.includes('kenny-bae'));
});

test('employee filter is ids plus names, and refuses an empty identity', () => {
  const filter = employeeOrFilter(
    ['profile-1', 'profile-1', 'auth-1'],
    ['Kenny Bae']
  );
  assert.equal(filter.startsWith('employee_id.eq.profile-1'), true);
  assert.equal(filter.includes('employee_id.eq.auth-1'), true);
  assert.equal(filter.includes('employee_name.ilike."Kenny Bae"'), true);
  assert.equal(filter.includes('employee_name.ilike.kenny-bae'), true);
  assert.equal(employeeOrFilter([], []), '');
  assert.equal(employeeOrFilter([null, ''], ['  ']), '');
});

test('legacy assigned_to id can be included for this employee', () => {
  const filter = employeeOrFilter(['profile-1'], [], ['assigned_to']);
  assert.equal(filter.includes('employee_id.eq.profile-1'), true);
  assert.equal(filter.includes('assigned_to.eq.profile-1'), true);
});

test('completed tasks follow status, flag, or completed_at', () => {
  assert.equal(taskIsCompleted({ status: 'done' }), true);
  assert.equal(taskIsCompleted({ status: 'todo', completed: true }), true);
  assert.equal(taskIsCompleted({ status: 'todo', completed_at: '2026-09-23T00:00:00Z' }), true);
  assert.equal(taskIsCompleted({ status: 'todo' }), false);
});

console.log('\nAll expoHotpathQueries tests passed.');
