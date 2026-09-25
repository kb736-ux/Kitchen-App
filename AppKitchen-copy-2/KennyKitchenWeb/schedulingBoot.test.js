'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const schedulingSrc = fs.readFileSync(path.join(__dirname, 'scheduling.js'), 'utf8');

function testSourceHasOneBootListener() {
  const listeners = schedulingSrc.match(/window\.addEventListener\(\s*'supabase-ready'/g) || [];
  assert.strictEqual(listeners.length, 1, 'scheduling.js should register one supabase-ready boot');
  assert.ok(!/from\('tasks'\)[\s\S]{0,80}select\('\*'\)/.test(
    schedulingSrc.slice(schedulingSrc.indexOf('async function bootSchedulingPage'))
  ));
  const bootStart = schedulingSrc.indexOf('async function bootSchedulingPage');
  const bootEnd = schedulingSrc.indexOf('window.addEventListener(\'supabase-ready\'', bootStart);
  const boot = schedulingSrc.slice(bootStart, bootEnd);
  assert.ok(boot.includes('Promise.all'), 'boot starts week shifts, roster, and pending count together');
  assert.ok(!boot.includes('cleanupPastShiftRequests'), 'page load must not scan every past shift');
  assert.ok(!boot.includes("from('tasks')"), 'page load must not download tasks');
}

function makeEl() {
  const el = {
    style: {},
    dataset: {},
    classList: {
      add() {},
      remove() {},
      contains() { return false; },
    },
    children: [],
    hidden: false,
    value: '',
    options: [],
    appendChild(child) { this.children.push(child); return child; },
    setAttribute() {},
    getAttribute() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    closest() { return null; },
    remove() {},
  };
  let text = '';
  let html = '';
  Object.defineProperty(el, 'textContent', {
    get() { return text; },
    set(v) { text = String(v == null ? '' : v); html = text; },
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return html; },
    set(v) { html = String(v == null ? '' : v); },
  });
  return el;
}

function loadScheduling(log) {
  const byId = {};
  const listeners = { window: {}, document: {} };
  const document = {
    head: makeEl(),
    createElement() { return makeEl(); },
    getElementById(id) {
      if (!byId[id]) byId[id] = makeEl();
      return byId[id];
    },
    querySelector(sel) {
      if (sel === '#schedule-matrix .sched-matrix-cell[data-day]') return makeEl();
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener(name, fn) {
      (listeners.document[name] = listeners.document[name] || []).push(fn);
    },
  };

  function query(table) {
    const q = { table, select: null, head: false, count: null, filters: [] };
    const api = {
      select(cols, opts) {
        q.select = cols;
        q.head = !!(opts && opts.head);
        q.count = opts && opts.count;
        return api;
      },
      eq(col, val) { q.filters.push({ op: 'eq', col, val }); return api; },
      gte(col, val) { q.filters.push({ op: 'gte', col, val }); return api; },
      lte(col, val) { q.filters.push({ op: 'lte', col, val }); return api; },
      lt(col, val) { q.filters.push({ op: 'lt', col, val }); return api; },
      in(col, val) { q.filters.push({ op: 'in', col, val }); return api; },
      order() { return api; },
      limit() { return api; },
      maybeSingle() { return api; },
      then(resolve, reject) {
        try {
          log.push(q);
          resolve(answer(q));
        } catch (err) {
          if (reject) reject(err);
          else throw err;
        }
      },
    };
    return api;
  }

  function answer(q) {
    if (q.table === 'shifts' && q.select && q.select.indexOf('employee_name') !== -1) {
      const start = (q.filters.find((f) => f.op === 'gte' && f.col === 'shift_date') || {}).val;
      return {
        data: [{
          id: 'shift-1',
          shift_date: start || '2026-09-21',
          start_time: '09:00:00',
          end_time: '17:00:00',
          position: 'Pastry',
          employee_name: 'Ada Lovelace',
        }],
        error: null,
      };
    }
    if (q.table === 'shift_requests' && q.head) {
      return { data: null, error: null, count: 3 };
    }
    if (q.table === 'tasks') {
      assert.ok(q.filters.some((f) => f.op === 'in' && f.col === 'shift_id'), 'task reads must be by shift_id');
      assert.notStrictEqual(q.select, '*');
      return {
        data: [{
          id: 'task-1',
          text: 'Prep vegetables',
          employee_name: 'Ada Lovelace',
          shift_id: 'shift-1',
          status: 'todo',
        }],
        error: null,
      };
    }
    return { data: [], error: null, count: 0 };
  }

  const context = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    parseInt,
    encodeURIComponent,
    decodeURIComponent,
    Map,
    Set,
    document,
  };
  context.window = context;
  context.globalThis = context;
  context.localStorage = {
    getItem() { return null; },
    setItem() {},
  };
  context.addEventListener = (name, fn) => {
    (listeners.window[name] = listeners.window[name] || []).push(fn);
  };
  context.dispatchEvent = (ev) => {
    (listeners.window[ev.type] || []).forEach((fn) => fn(ev));
  };

  vm.createContext(context);
  vm.runInContext(schedulingSrc, context, { filename: 'scheduling.js' });

  let rosterCalls = 0;
  context.loadEmployeePositionsFromSupabase = async function loadEmployeePositionsFromSupabase() {
    rosterCalls += 1;
    context._profileBackedEmployeeNames = new Set(['Ada Lovelace']);
    return { 'Ada Lovelace': ['Server'] };
  };
  context.getEmployeePositions = function getEmployeePositions() {
    return { 'Ada Lovelace': ['Server'] };
  };
  context.getEmployeeDisplayName = function getEmployeeDisplayName(name) { return name; };
  context.supabaseClient = { from: query };
  context.ORG_ID = 'org-1';

  return {
    context,
    byId,
    rosterCalls: () => rosterCalls,
    dispatchReady() {
      context.dispatchEvent({ type: 'supabase-ready' });
    },
  };
}

async function flush() {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

function shiftQueries(log) {
  return log.filter((q) => q.table === 'shifts');
}

function hasWeekBound(q) {
  return q.filters.some((f) => f.op === 'gte' && f.col === 'shift_date')
    && q.filters.some((f) => f.op === 'lte' && f.col === 'shift_date');
}

async function testBootIsWeekRosterAndPending() {
  const log = [];
  const harness = loadScheduling(log);
  harness.dispatchReady();
  harness.dispatchReady();
  await flush();

  assert.strictEqual(harness.rosterCalls(), 1, 'roster loads once per boot');

  const shifts = shiftQueries(log);
  assert.strictEqual(shifts.length, 1, 'one week shift query, not a second scan for names or positions');
  assert.ok(hasWeekBound(shifts[0]), 'week shift query is date-bounded');
  assert.ok(shifts[0].select.includes('position'));
  assert.ok(shifts[0].select.includes('employee_name'));
  assert.ok(!log.some((q) => q.filters.some((f) => f.op === 'lt')), 'no all-past-shifts scan');
  assert.ok(!log.some((q) => q.table === 'tasks'), 'boot does not fetch tasks');

  const pending = log.filter((q) => q.table === 'shift_requests' && q.head);
  assert.strictEqual(pending.length, 1, 'one pending-count query');
  assert.strictEqual(harness.byId['requests-badge'].textContent, '3');
  assert.strictEqual(harness.byId['requests-badge'].style.display, 'block');

  const positionHtml = harness.byId['position-select'].innerHTML;
  assert.ok(positionHtml.includes('Server'), 'positions include employee_positions labels');
  assert.ok(positionHtml.includes('Pastry'), 'positions include this week\'s shift labels');
  assert.ok(!log.some((q) => q.table === 'shifts' && q.select === 'position'), 'dropdown does not scan shifts.position');
}

async function testLaterPositionSelectStaysOnThisWeek() {
  const log = [];
  const harness = loadScheduling(log);
  harness.dispatchReady();
  await flush();
  log.length = 0;
  await harness.context.populatePositionSelect();
  const shifts = shiftQueries(log);
  assert.strictEqual(shifts.length, 1);
  assert.strictEqual(shifts[0].select, 'position');
  assert.ok(hasWeekBound(shifts[0]));
  assert.ok(!shifts[0].filters.some((f) => f.op === 'lt'));
}

async function testOpenShiftLoadsTasksForThatShiftOnly() {
  const log = [];
  const harness = loadScheduling(log);
  log.length = 0;
  const container = makeEl();
  const group = makeEl();
  await harness.context.loadExistingTasksForEmployee('Ada Lovelace', container, group, {
    shiftId: 'shift-1',
    shiftDate: '2026-09-21',
    startTime: '09:00',
    endTime: '17:00',
  });
  const tasks = log.filter((q) => q.table === 'tasks');
  assert.strictEqual(tasks.length, 1);
  assert.notStrictEqual(tasks[0].select, '*');
  assert.ok(tasks[0].filters.some((f) => f.op === 'in' && f.col === 'shift_id'));
  assert.strictEqual(group.style.display, 'block');
  assert.strictEqual(container.children.length, 1);
  assert.strictEqual(container.children[0].dataset.taskDescription, 'Prep vegetables');
}

async function main() {
  testSourceHasOneBootListener();
  await testBootIsWeekRosterAndPending();
  await testLaterPositionSelectStaysOnThisWeek();
  await testOpenShiftLoadsTasksForThatShiftOnly();
  console.log('schedulingBoot.test.js: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
