/**
 * Run: node KennyKitchenWeb/missingClockOut.test.js
 */
const assert = require('assert');
const {
  isMissingClockOut,
  scheduledShiftEnd,
  shiftEndDate,
  buildTimesheetRows,
  formatExportHours,
  missingClockOutWarning,
  timesheetCsv,
  totalsCsv,
  computeHours,
  NOTE_MISSING,
  NOTE_OPEN,
} = require('./missingClockOut.js');

function test(name, fn) {
  fn();
  console.log('ok', name);
}

const wedIn = new Date(2026, 8, 23, 17, 7, 0); // Wed Sep 23, 5:07 PM
const weekStart = new Date(2026, 8, 21, 0, 0, 0); // Mon Sep 21
const weekEnd = new Date(2026, 8, 28, 0, 0, 0);
const samShift = {
  id: 'sh-sam',
  employee_name: 'Sam',
  shift_date: '2026-09-23',
  start_time: '17:00:00',
  end_time: '22:00:00',
};

function openPunch(at, extra) {
  return {
    id: 'in1',
    employee_name: 'Sam',
    punch_type: 'in',
    punched_at: (at instanceof Date ? at : new Date(at)).toISOString(),
    ...extra,
  };
}

test('still inside the shift stays Still clocked in', () => {
  const rows = buildTimesheetRows({
    punches: [openPunch(wedIn)],
    shifts: [samShift],
    weekStart,
    weekEnd,
    now: new Date(2026, 8, 23, 18, 0, 0),
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].missingClockOut, false);
  assert.equal(rows[0].note, NOTE_OPEN);
  assert.equal(rows[0].hours, null);
});

test('exactly 30 minutes past shift end is not missing yet', () => {
  const shiftEnd = shiftEndDate(samShift);
  const now = new Date(shiftEnd.getTime() + 30 * 60 * 1000);
  assert.equal(isMissingClockOut({ punchedAt: wedIn, now, shiftEnd }), false);
});

test('31 minutes past shift end is Missing clock-out', () => {
  const shiftEnd = scheduledShiftEnd(openPunch(wedIn), [samShift]);
  assert.equal(shiftEnd.getHours(), 22);
  const now = new Date(shiftEnd.getTime() + 31 * 60 * 1000);
  const rows = buildTimesheetRows({
    punches: [openPunch(wedIn)],
    shifts: [samShift],
    weekStart,
    weekEnd,
    now,
  });
  assert.equal(rows[0].missingClockOut, true);
  assert.equal(rows[0].note, NOTE_MISSING);
  assert.equal(rows[0].hours, null);
});

test('open since Wed 5:07 PM is flagged by Friday when the shift ended at 10 PM', () => {
  const rows = buildTimesheetRows({
    punches: [openPunch(wedIn)],
    shifts: [samShift],
    weekStart,
    weekEnd,
    now: new Date(2026, 8, 25, 12, 0, 0),
  });
  assert.equal(rows[0].missingClockOut, true);
  assert.equal(rows[0].note, NOTE_MISSING);
  assert.equal(rows[0].clockInLabel, '5:07 PM');
});

test('no shift that day uses 12 hours, not the shift grace', () => {
  const at12h = new Date(wedIn.getTime() + 12 * 60 * 60 * 1000);
  assert.equal(isMissingClockOut({ punchedAt: wedIn, now: at12h, shiftEnd: null }), false);
  const rows = buildTimesheetRows({
    punches: [openPunch(wedIn)],
    shifts: [],
    weekStart,
    weekEnd,
    now: new Date(wedIn.getTime() + 12 * 60 * 60 * 1000 + 60 * 1000),
  });
  assert.equal(rows[0].missingClockOut, true);
  assert.equal(rows[0].note, NOTE_MISSING);
});

test('another employee\'s shift does not set the end', () => {
  const end = scheduledShiftEnd(openPunch(wedIn), [{
    id: 'other',
    employee_name: 'Blair',
    shift_date: '2026-09-23',
    start_time: '17:00',
    end_time: '22:00',
  }]);
  assert.equal(end, null);
});

test('employee_id match wins when the display name differs', () => {
  const punch = openPunch(wedIn, { employee_id: 'emp-1', employee_name: 'Sammy' });
  const end = scheduledShiftEnd(punch, [{
    id: 'sh1',
    employee_id: 'emp-1',
    employee_name: 'Sam Rivera',
    shift_date: '2026-09-23',
    start_time: '17:00',
    end_time: '22:00',
  }]);
  assert.equal(end.getHours(), 22);
});

test('overnight shift end is the next morning, plus 30 minutes', () => {
  const punch = openPunch(new Date(2026, 8, 23, 22, 10, 0));
  const shift = {
    id: 'night',
    employee_name: 'Sam',
    shift_date: '2026-09-23',
    start_time: '22:00',
    end_time: '02:00',
  };
  const end = scheduledShiftEnd(punch, [shift]);
  assert.equal(end.getDate(), 24);
  assert.equal(end.getHours(), 2);
  assert.equal(isMissingClockOut({
    punchedAt: punch.punched_at,
    now: new Date(2026, 8, 24, 2, 20, 0),
    shiftEnd: end,
  }), false);
  assert.equal(isMissingClockOut({
    punchedAt: punch.punched_at,
    now: new Date(2026, 8, 24, 2, 31, 0),
    shiftEnd: end,
  }), true);
});

test('a closed punch is not flagged and keeps its hours', () => {
  const rows = buildTimesheetRows({
    punches: [
      openPunch(wedIn),
      { id: 'out1', employee_name: 'Sam', punch_type: 'out', punched_at: new Date(2026, 8, 23, 22, 0, 0).toISOString() },
    ],
    shifts: [samShift],
    weekStart,
    weekEnd,
    now: new Date(2026, 8, 25, 12, 0, 0),
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].missingClockOut, false);
  assert.equal(rows[0].note, '');
  assert.equal(rows[0].hours, 4.88);
  assert.equal(formatExportHours(rows[0].hours), '4.88');
});

test('export leaves missing hours blank and warns before a zero is implied', () => {
  const rows = buildTimesheetRows({
    punches: [openPunch(wedIn)],
    shifts: [samShift],
    weekStart,
    weekEnd,
    now: new Date(2026, 8, 25, 12, 0, 0),
  });
  assert.equal(formatExportHours(rows[0].hours), '');
  const warning = missingClockOutWarning(rows);
  assert.match(warning, /Missing clock-out: 1 punch is/);
  const csv = timesheetCsv(rows);
  assert.match(csv, /Flag/);
  assert.match(csv, /Missing clock-out/);
  assert.equal(csv.includes('0.00'), false);
  const totals = totalsCsv([openPunch(wedIn)], weekStart, {
    shifts: [samShift],
    now: new Date(2026, 8, 25, 12, 0, 0),
  });
  assert.match(totals, /Sam,,,Missing clock-out/);
  assert.equal(totals.includes('0.00'), false);
});

test('totals add closed hours and still count a missing punch', () => {
  const rows = buildTimesheetRows({
    punches: [
      openPunch(new Date(2026, 8, 22, 9, 0, 0), { id: 'a' }),
      { id: 'b', employee_name: 'Sam', punch_type: 'out', punched_at: new Date(2026, 8, 22, 17, 0, 0).toISOString() },
      openPunch(wedIn, { id: 'c' }),
    ],
    shifts: [samShift],
    weekStart,
    weekEnd,
    now: new Date(2026, 8, 25, 12, 0, 0),
  });
  assert.equal(rows.filter((row) => row.missingClockOut).length, 1);
  const punches = [
    openPunch(new Date(2026, 8, 22, 9, 0, 0), { id: 'a' }),
    { id: 'b', employee_name: 'Sam', punch_type: 'out', punched_at: new Date(2026, 8, 22, 17, 0, 0).toISOString() },
    openPunch(wedIn, { id: 'c' }),
  ];
  const now = new Date(2026, 8, 25, 12, 0, 0);
  const split = computeHours(punches, weekStart, { shifts: [samShift], now });
  assert.equal(split[0].regularHours, 8);
  assert.equal(split[0].overtimeHours, 0);
  assert.equal(split[0].missingClockOut, true);
  const totals = totalsCsv(punches, weekStart, { shifts: [samShift], now });
  assert.match(totals, /Sam,8\.00,0\.00,Missing clock-out/);
  assert.equal(missingClockOutWarning(rows).includes('1 punch is'), true);
});

test('two employees are not paired with each other', () => {
  const rows = buildTimesheetRows({
    punches: [
      { id: '1', employee_name: 'Sam', user_id: 'u1', punch_type: 'in', punched_at: wedIn.toISOString() },
      { id: '2', employee_name: 'Blair', user_id: 'u2', punch_type: 'out', punched_at: new Date(2026, 8, 23, 22, 0, 0).toISOString() },
    ],
    shifts: [samShift],
    weekStart,
    weekEnd,
    now: new Date(2026, 8, 23, 18, 0, 0),
  });
  assert.equal(rows.length, 2);
  const sam = rows.find((row) => row.employee === 'Sam');
  assert.equal(sam.open, true);
  assert.equal(sam.note, NOTE_OPEN);
  assert.equal(sam.missingClockOut, false);
});

test('a clock-out after the week still closes the punch', () => {
  const rows = buildTimesheetRows({
    punches: [
      openPunch(new Date(2026, 8, 27, 18, 0, 0), { id: 'sun-in' }),
      {
        id: 'mon-out',
        employee_name: 'Sam',
        punch_type: 'out',
        punched_at: new Date(2026, 8, 28, 1, 0, 0).toISOString(),
      },
    ],
    shifts: [],
    weekStart,
    weekEnd,
    now: new Date(2026, 8, 29, 12, 0, 0),
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].open, false);
  assert.equal(rows[0].missingClockOut, false);
  assert.equal(rows[0].hours, 6);
});

test('an open punch from before this week still shows when it overlaps the week', () => {
  const rows = buildTimesheetRows({
    punches: [openPunch(new Date(2026, 8, 18, 17, 0, 0))],
    shifts: [],
    weekStart,
    weekEnd,
    now: new Date(2026, 8, 25, 12, 0, 0),
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].missingClockOut, true);
});

function closedSpan(id, start, end) {
  return [
    { id: `${id}-in`, employee_name: 'Sam', user_id: 'sam', punch_type: 'in', punched_at: start.toISOString() },
    { id: `${id}-out`, employee_name: 'Sam', user_id: 'sam', punch_type: 'out', punched_at: end.toISOString() },
  ];
}

function daySpan(id, day, startHour, endHour) {
  return closedSpan(
    id,
    new Date(2026, 8, day, startHour, 0, 0),
    new Date(2026, 8, day, endHour, 0, 0),
  );
}

test('38 hours in the workweek is all regular', () => {
  const punches = [
    ...daySpan('m', 21, 8, 16),
    ...daySpan('t', 22, 8, 16),
    ...daySpan('w', 23, 8, 16),
    ...daySpan('r', 24, 8, 16),
    ...daySpan('f', 25, 8, 14),
  ];
  const [sam] = computeHours(punches, weekStart);
  assert.equal(sam.totalHours, 38);
  assert.equal(sam.regularHours, 38);
  assert.equal(sam.overtimeHours, 0);
  assert.equal(sam.missingClockOut, false);
  const csv = totalsCsv(punches, weekStart);
  assert.match(csv, /Sam,38\.00,0\.00,/);
});

test('44 hours in the workweek is 40 regular and 4 overtime', () => {
  const punches = [
    ...daySpan('m', 21, 8, 16),
    ...daySpan('t', 22, 8, 16),
    ...daySpan('w', 23, 8, 16),
    ...daySpan('r', 24, 8, 16),
    ...daySpan('f', 25, 8, 16),
    ...daySpan('s', 26, 8, 12),
  ];
  const [sam] = computeHours(punches, weekStart);
  assert.equal(sam.totalHours, 44);
  assert.equal(sam.regularHours, 40);
  assert.equal(sam.overtimeHours, 4);
  const csv = totalsCsv(punches, weekStart);
  assert.match(csv, /Sam,40\.00,4\.00,/);
});

test('a punch that crosses the week boundary counts only the hours inside it', () => {
  const punches = closedSpan(
    'cross',
    new Date(2026, 8, 20, 22, 0, 0),
    new Date(2026, 8, 21, 6, 0, 0),
  );
  const thisWeek = computeHours(punches, weekStart);
  assert.equal(thisWeek[0].totalHours, 6);
  assert.equal(thisWeek[0].regularHours, 6);
  assert.equal(thisWeek[0].overtimeHours, 0);
  const previousWeek = computeHours(punches, new Date(2026, 8, 14, 0, 0, 0));
  assert.equal(previousWeek[0].totalHours, 2);
  assert.equal(previousWeek[0].overtimeHours, 0);
});

test('an open missing clock-out does not add overtime', () => {
  const punches = [
    ...daySpan('m', 21, 8, 16),
    ...daySpan('t', 22, 8, 16),
    ...daySpan('w', 23, 8, 16),
    ...daySpan('r', 24, 8, 16),
    ...daySpan('f', 25, 8, 16),
    ...daySpan('s', 26, 8, 12),
    openPunch(wedIn, { id: 'still-open', user_id: 'sam' }),
  ];
  const now = new Date(2026, 8, 25, 12, 0, 0);
  const [sam] = computeHours(punches, weekStart, { shifts: [samShift], now });
  assert.equal(sam.totalHours, 44);
  assert.equal(sam.regularHours, 40);
  assert.equal(sam.overtimeHours, 4);
  assert.equal(sam.missingClockOut, true);
  const csv = totalsCsv(punches, weekStart, { shifts: [samShift], now });
  assert.match(csv, /Sam,40\.00,4\.00,Missing clock-out/);
});

console.log('\nAll missingClockOut tests passed.');
