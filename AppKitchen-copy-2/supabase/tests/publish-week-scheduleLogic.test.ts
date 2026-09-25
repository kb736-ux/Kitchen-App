import assert from "node:assert/strict";
import test from "node:test";
import {
  applySnapshot,
  buildMessage,
  diffWeek,
  groupShifts,
  isMonday,
  weekRangeLabel,
} from "../functions/publish-week/scheduleLogic.ts";

const ada = {
  id: "ada-id",
  user_id: "user-ada",
  employee_name: "Ada Lovelace",
  email: "ada@example.com",
};
const ken = {
  id: "ken-id",
  user_id: "user-ken",
  employee_name: "Ken",
  email: "ken@example.com",
};

test("Monday check matches the web week start", () => {
  assert.equal(isMonday("2026-09-21"), true);
  assert.equal(isMonday("2026-09-25"), false);
  assert.equal(weekRangeLabel("2026-09-21"), "Sep 21–Sep 27");
});

test("one person with two shifts is one email recipient", () => {
  const people = groupShifts([
    { employee_id: "ada-id", employee_name: "Ada Lovelace", shift_date: "2026-09-22", start_time: "16:00:00", end_time: "22:00:00", position: "Server" },
    { employee_name: "Ada Lovelace", shift_date: "2026-09-21", start_time: "09:00", end_time: "17:00", position: "Line Cook" },
    { employee_id: "ken-id", employee_name: "Ken", shift_date: "2026-09-23", start_time: "10:00", end_time: "14:30", position: "Prep" },
  ], [ada, ken]);
  assert.equal(people.length, 2);
  const adaPerson = people.find((p) => p.key === "profile:ada-id");
  assert.ok(adaPerson);
  assert.equal(adaPerson.shifts.length, 2);
  assert.equal(adaPerson.shifts[0].date, "2026-09-21");
  assert.equal(adaPerson.shifts[0].position, "Line Cook");
  const message = buildMessage({
    person: { ...adaPerson, kind: "new" },
    orgName: "Kenny's",
    rangeLabel: "Sep 21–Sep 27",
    appUrl: "https://sheekapp.com",
  });
  assert.equal(message.subject, "Your shifts at Kenny's · Sep 21");
  assert.match(message.html, /Get the Sheek app/);
  assert.match(message.html, /Scheduled with Sheek/);
  assert.match(message.text, /Mon, Sep 21 · 9 AM–5 PM · Line Cook/);
  assert.match(message.text, /Tue, Sep 22 · 4 PM–10 PM · Server/);
  assert.match(message.html, /Kenny&#39;s|Kenny's/);
  assert.equal(message.html.includes("<script"), false);

  const weekOfSep28 = weekRangeLabel("2026-09-28");
  assert.equal(weekOfSep28, "Sep 28–Oct 4");
  const fallback = buildMessage({
    person: { ...adaPerson, kind: "new" },
    orgName: "  ",
    rangeLabel: weekOfSep28,
    appUrl: "https://sheekapp.com",
  });
  assert.equal(fallback.subject, "Your shifts this week · Sep 28");
  const removed = buildMessage({
    person: { ...adaPerson, kind: "cleared", shifts: [] },
    orgName: "Kenny's",
    rangeLabel: weekOfSep28,
    appUrl: "https://sheekapp.com",
  });
  assert.equal(removed.subject, "Your shifts at Kenny's changed · Sep 28");
  assert.match(removed.text, /Scheduled with Sheek/);
});

test("re-publish emails only the person whose shifts changed", () => {
  const current = groupShifts([
    { employee_id: "ada-id", employee_name: "Ada", shift_date: "2026-09-21", start_time: "09:00", end_time: "15:00", position: "Line Cook" },
    { employee_id: "ken-id", employee_name: "Ken", shift_date: "2026-09-23", start_time: "10:00", end_time: "14:30", position: "Prep" },
  ], [ada, ken]);
  const previous = {
    "profile:ada-id": {
      name: "Ada Lovelace",
      email: "ada@example.com",
      shifts: [{ date: "2026-09-21", start: "09:00", end: "17:00", position: "Line Cook" }],
    },
    "profile:ken-id": {
      name: "Ken",
      email: "ken@example.com",
      shifts: [{ date: "2026-09-23", start: "10:00", end: "14:30", position: "Prep" }],
    },
  };
  const plan = diffWeek(previous, current);
  assert.deepEqual(plan.send.map((p) => p.name), ["Ada Lovelace"]);
  assert.equal(plan.send[0].kind, "updated");
  assert.deepEqual(plan.unchanged.map((p) => p.key), ["profile:ken-id"]);

  const failed = applySnapshot(previous, plan.unchanged, new Set());
  assert.equal(failed["profile:ada-id"].shifts[0].end, "17:00");

  const saved = applySnapshot(previous, plan.unchanged, new Set(plan.send));
  assert.equal(saved["profile:ada-id"].shifts[0].end, "15:00");
  assert.equal(saved["profile:ken-id"].shifts[0].end, "14:30");

  const again = diffWeek(saved, current);
  assert.equal(again.send.length, 0);
  assert.equal(again.unchanged.length, 2);
});

test("removing every shift for someone is one cleared email, not a silent drop", () => {
  const current = groupShifts([
    { employee_id: "ken-id", employee_name: "Ken", shift_date: "2026-09-23", start_time: "10:00", end_time: "14:00", position: "Prep" },
  ], [ada, ken]);
  const previous = {
    "name:ada lovelace": {
      name: "Ada Lovelace",
      email: "ada@example.com",
      shifts: [{ date: "2026-09-21", start: "09:00", end: "17:00", position: "Line Cook" }],
    },
    "profile:ken-id": {
      name: "Ken",
      email: "ken@example.com",
      shifts: [{ date: "2026-09-23", start: "10:00", end: "14:00", position: "Prep" }],
    },
  };
  const plan = diffWeek(previous, current);
  assert.equal(plan.send.length, 1);
  assert.equal(plan.send[0].kind, "cleared");
  assert.equal(plan.send[0].email, "ada@example.com");
  const saved = applySnapshot(previous, plan.unchanged, new Set(plan.send));
  assert.equal(saved["name:ada lovelace"], undefined);
  assert.ok(saved["profile:ken-id"]);
});
