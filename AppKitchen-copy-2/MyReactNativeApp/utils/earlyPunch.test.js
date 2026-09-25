/**
 * Run: node --experimental-default-type=module utils/earlyPunch.test.js
 */
import assert from 'node:assert/strict';
import {
  parseShiftStart,
  evaluateClockIn,
  evaluateClockOut,
  pairPunches,
  latestOpenPunch,
  currentWeekRange,
  formatDurationMs,
} from './earlyPunch.js';

function test(name, fn) {
  fn();
  console.log('ok', name);
}

test('parseShiftStart builds a local Date from DATE + time', () => {
  const d = parseShiftStart('2026-09-13', '16:00:00');
  assert.ok(d instanceof Date);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8);
  assert.equal(d.getDate(), 13);
  assert.equal(d.getHours(), 16);
  assert.equal(d.getMinutes(), 0);
});

test('parseShiftStart accepts HH:MM and ISO date prefix', () => {
  const d = parseShiftStart('2026-09-13T00:00:00.000Z', '09:30');
  assert.equal(d.getHours(), 9);
  assert.equal(d.getMinutes(), 30);
});

test('parseShiftStart returns null when start is missing', () => {
  assert.equal(parseShiftStart('2026-09-13', null), null);
  assert.equal(parseShiftStart('', '16:00'), null);
});

test('clock-in before scheduled start is blocked', () => {
  const scheduledStart = parseShiftStart('2026-09-13', '16:00:00');
  const now = new Date(2026, 8, 13, 15, 0, 0);
  const result = evaluateClockIn({ now, scheduledStart });
  assert.equal(result.allowed, false);
  assert.equal(result.isEarly, true);
  assert.equal(result.reason, 'before_shift_start');
  assert.equal(result.message, '');
});

test('clock-in at scheduled start is allowed', () => {
  const scheduledStart = parseShiftStart('2026-09-13', '16:00:00');
  const now = new Date(2026, 8, 13, 16, 0, 0);
  const result = evaluateClockIn({ now, scheduledStart });
  assert.equal(result.allowed, true);
  assert.equal(result.isEarly, false);
  assert.equal(result.reason, 'on_time');
});

test('clock-in after scheduled start is allowed', () => {
  const scheduledStart = parseShiftStart('2026-09-13', '16:00:00');
  const now = new Date(2026, 8, 13, 16, 5, 0);
  const result = evaluateClockIn({ now, scheduledStart });
  assert.equal(result.allowed, true);
  assert.equal(result.isEarly, false);
});

test('no scheduled shift allows clock-in (not early)', () => {
  const now = new Date(2026, 8, 13, 10, 0, 0);
  const result = evaluateClockIn({ now, scheduledStart: null });
  assert.equal(result.allowed, true);
  assert.equal(result.isEarly, false);
  assert.equal(result.reason, 'no_schedule');
});

test('graceMs can permit a slightly early punch', () => {
  const scheduledStart = parseShiftStart('2026-09-13', '16:00:00');
  const now = new Date(2026, 8, 13, 15, 59, 30);
  assert.equal(evaluateClockIn({ now, scheduledStart, graceMs: 0 }).allowed, false);
  assert.equal(evaluateClockIn({ now, scheduledStart, graceMs: 60_000 }).allowed, true);
});

test('clock-out requires an open IN punch', () => {
  assert.equal(evaluateClockOut({ openPunch: null }).allowed, false);
  assert.equal(evaluateClockOut({ openPunch: { punch_type: 'in' } }).allowed, true);
});

test('pairPunches pairs consecutive in/out and leaves a trailing IN open', () => {
  const punches = [
    { id: '1', punch_type: 'in', punched_at: '2026-09-14T12:00:00' },
    { id: '2', punch_type: 'out', punched_at: '2026-09-14T20:00:00' },
    { id: '3', punch_type: 'in', punched_at: '2026-09-15T16:00:00' },
  ];
  const pairs = pairPunches(punches);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].in.id, '1');
  assert.equal(pairs[0].out.id, '2');
  assert.equal(pairs[1].in.id, '3');
  assert.equal(pairs[1].out, null);
  assert.equal(latestOpenPunch(punches).id, '3');
});

test('latestOpenPunch is null when last punch is OUT', () => {
  const punches = [
    { punch_type: 'in', punched_at: '2026-09-14T12:00:00' },
    { punch_type: 'out', punched_at: '2026-09-14T20:00:00' },
  ];
  assert.equal(latestOpenPunch(punches), null);
});

test('currentWeekRange is Monday-local through next Monday', () => {
  const wed = new Date(2026, 8, 16, 18, 0, 0); // Wednesday
  const { start, end } = currentWeekRange(wed);
  assert.equal(start.getDay(), 1);
  assert.equal(start.getDate(), 14);
  assert.equal(end.getDate(), 21);
  assert.equal(end.getHours(), 0);
});

test('formatDurationMs', () => {
  assert.equal(formatDurationMs(0), '0m');
  assert.equal(formatDurationMs(45 * 60_000), '45m');
  assert.equal(formatDurationMs(2 * 60 * 60_000), '2h');
  assert.equal(formatDurationMs(2 * 60 * 60_000 + 15 * 60_000), '2h 15m');
});

console.log('\nAll earlyPunch tests passed.');
