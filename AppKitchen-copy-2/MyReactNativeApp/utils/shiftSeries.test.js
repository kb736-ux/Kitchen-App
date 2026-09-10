/**
 * Run: node --experimental-default-type=module utils/shiftSeries.test.js
 */
import assert from 'node:assert/strict';
import {
  formatShiftDate,
  formatShiftTime,
  formatShiftTimeRange,
  getRepeatSummary,
  groupRepeatingShifts,
  isShiftSeries,
} from './shiftSeries.js';

function test(name, fn) {
  fn();
  console.log('ok', name);
}

test('formatShiftDate keeps Thursday as one token (no mid-word break)', () => {
  const label = formatShiftDate('2026-11-05');
  assert.equal(label.includes('Thursday'), true);
  assert.equal(label.includes('\n'), false);
  assert.equal(/Thurs(?!day)/.test(label.replace(/\u00A0/g, ' ')), false);
  assert.equal(label.includes('\u00A0'), true);
  assert.equal(label.replace(/\u00A0/g, ' '), 'Thursday Nov 5');
});

test('formatShiftDate Saturday May 1 stays unbroken', () => {
  assert.equal(formatShiftDate('2027-05-01').replace(/\u00A0/g, ' '), 'Saturday May 1');
});

test('formatShiftTimeRange keeps AM/PM glued to the clock', () => {
  const range = formatShiftTimeRange('14:00:00', '21:00:00');
  assert.equal(range.includes('2:00\u00A0PM'), true);
  assert.equal(range.includes('9:00\u00A0PM'), true);
  assert.equal(/\sPM/.test(range.replace(/\u00A0/g, '')), false);
});

test('weekly series groups and summary wraps at words, not inside Thursday', () => {
  const rows = [];
  const start = new Date('2026-11-05T12:00:00');
  for (let i = 0; i < 37; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i * 7);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    rows.push({
      id: i + 1,
      employee_name: 'Kenny',
      position: 'Server',
      start_time: '14:00:00',
      end_time: '21:00:00',
      shift_date: ymd,
    });
  }
  const groups = groupRepeatingShifts(rows);
  assert.equal(groups.length, 1);
  assert.equal(isShiftSeries(groups[0]), true);
  assert.equal(groups[0].repeatCount, 37);
  const summary = getRepeatSummary(groups[0]);
  assert.match(summary, /^Repeats weekly for 37 weeks until /);
  assert.equal(summary.includes('Thursday'), true);
  assert.equal(/Thursda(?!y)/.test(summary.replace(/\u00A0/g, ' ')), false);
});

console.log('shiftSeries tests passed');
