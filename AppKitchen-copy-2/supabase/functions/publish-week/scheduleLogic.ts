/** Pure publish-week diff and email copy. No secrets, no network. */

export type ShiftLine = {
  date: string;
  start: string;
  end: string;
  position: string;
};

export type SnapshotEntry = {
  name: string;
  email: string | null;
  shifts: ShiftLine[];
};

export type Person = {
  key: string;
  name: string;
  email: string | null;
  userId: string | null;
  shifts: ShiftLine[];
  kind: "new" | "updated" | "cleared";
  prevKey: string | null;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function isMonday(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && dt.getUTCDay() === 1;
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function normName(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function hm(value: unknown): string {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return raw;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function profileDisplay(p: Record<string, unknown>): string {
  const both = [p.first_name, p.last_name].map((x) => String(x || "").trim()).filter(Boolean).join(" ");
  return String(p.display_name || p.full_name || both || p.employee_name || "").trim();
}

function profileAliases(p: Record<string, unknown>): string[] {
  const both = [p.first_name, p.last_name].map((x) => String(x || "").trim()).filter(Boolean).join(" ");
  const names = [p.employee_name, p.display_name, p.full_name, both]
    .map(normName)
    .filter(Boolean);
  return [...new Set(names)];
}

export function groupShifts(rows: Record<string, unknown>[], profiles: Record<string, unknown>[]): Person[] {
  const byId = new Map<string, Record<string, unknown>>();
  const byName = new Map<string, Record<string, unknown>>();
  for (const p of profiles) {
    const id = String(p.id || "");
    if (id) byId.set(id, p);
    for (const alias of profileAliases(p)) {
      if (!byName.has(alias)) byName.set(alias, p);
    }
  }

  const grouped = new Map<string, Person>();
  for (const row of rows) {
    const employeeId = String(row.employee_id || "").trim();
    const employeeName = String(row.employee_name || "").trim();
    const profile = (employeeId && byId.get(employeeId)) || byName.get(normName(employeeName)) || null;
    const key = profile?.id ? `profile:${profile.id}` : (normName(employeeName) ? `name:${normName(employeeName)}` : "");
    if (!key) continue;
    const name = (profile ? profileDisplay(profile) : employeeName) || "Staff";
    let person = grouped.get(key);
    if (!person) {
      person = {
        key,
        name,
        email: String(profile?.email || "").trim().toLowerCase() || null,
        userId: profile?.user_id ? String(profile.user_id) : null,
        shifts: [],
        kind: "new",
        prevKey: null,
      };
      grouped.set(key, person);
    }
    person.shifts.push({
      date: String(row.shift_date || "").slice(0, 10),
      start: hm(row.start_time),
      end: hm(row.end_time),
      position: String(row.position || "").trim() || "Shift",
    });
  }

  for (const person of grouped.values()) person.shifts = sortShifts(person.shifts);
  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

function sortShifts(shifts: ShiftLine[]): ShiftLine[] {
  return [...shifts].sort((a, b) =>
    a.date.localeCompare(b.date) ||
    a.start.localeCompare(b.start) ||
    a.end.localeCompare(b.end) ||
    a.position.localeCompare(b.position)
  );
}

function fingerprint(shifts: ShiftLine[]): string {
  return JSON.stringify(sortShifts(shifts));
}

export function asSnapshot(raw: unknown): Record<string, SnapshotEntry> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, SnapshotEntry> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    const shifts = Array.isArray(entry.shifts)
      ? entry.shifts.map((s) => {
        const row = (s || {}) as Record<string, unknown>;
        return {
          date: String(row.date || "").slice(0, 10),
          start: hm(row.start),
          end: hm(row.end),
          position: String(row.position || "").trim() || "Shift",
        };
      })
      : [];
    out[key] = {
      name: String(entry.name || "Staff"),
      email: String(entry.email || "").trim().toLowerCase() || null,
      shifts: sortShifts(shifts),
    };
  }
  return out;
}

export function diffWeek(previous: Record<string, SnapshotEntry>, current: Person[]) {
  const claimed = new Set<string>();
  const unchanged: Person[] = [];
  const send: Person[] = [];

  for (const person of current) {
    const prev = matchPrevious(previous, person, claimed);
    if (prev) claimed.add(prev.key);
    const same = !!prev && fingerprint(prev.entry.shifts) === fingerprint(person.shifts);
    const next: Person = {
      ...person,
      kind: prev ? "updated" : "new",
      prevKey: prev?.key || null,
      email: person.email || prev?.entry.email || null,
      name: person.name || prev?.entry.name || "Staff",
    };
    if (same) unchanged.push(next);
    else send.push(next);
  }

  for (const [key, entry] of Object.entries(previous)) {
    if (claimed.has(key)) continue;
    send.push({
      key,
      name: entry.name || "Staff",
      email: entry.email,
      userId: null,
      shifts: [],
      kind: "cleared",
      prevKey: key,
    });
  }

  return { unchanged, send };
}

function matchPrevious(
  previous: Record<string, SnapshotEntry>,
  person: Person,
  claimed: Set<string>,
): { key: string; entry: SnapshotEntry } | null {
  if (previous[person.key] && !claimed.has(person.key)) {
    return { key: person.key, entry: previous[person.key] };
  }
  const email = (person.email || "").toLowerCase();
  const name = normName(person.name);
  for (const [key, entry] of Object.entries(previous)) {
    if (claimed.has(key)) continue;
    const entryEmail = (entry.email || "").toLowerCase();
    if (email && entryEmail && email === entryEmail) return { key, entry };
  }
  for (const [key, entry] of Object.entries(previous)) {
    if (claimed.has(key)) continue;
    if (name && normName(entry.name) === name) return { key, entry };
  }
  return null;
}

export function applySnapshot(
  previous: Record<string, SnapshotEntry>,
  unchanged: Person[],
  succeeded: Set<Person>,
): Record<string, SnapshotEntry> {
  const next: Record<string, SnapshotEntry> = {};
  for (const [key, entry] of Object.entries(previous)) {
    next[key] = {
      name: entry.name,
      email: entry.email,
      shifts: entry.shifts.map((s) => ({ ...s })),
    };
  }

  const keep = (person: Person) => {
    if (person.prevKey && person.prevKey !== person.key) delete next[person.prevKey];
    next[person.key] = {
      name: person.name,
      email: person.email,
      shifts: person.shifts.map((s) => ({ ...s })),
    };
  };

  for (const person of unchanged) keep(person);
  for (const person of succeeded) {
    if (person.kind === "cleared") {
      delete next[person.key];
      if (person.prevKey) delete next[person.prevKey];
      continue;
    }
    keep(person);
  }
  return next;
}

function formatTime(hmValue: string): string {
  const [hStr, mStr] = hmValue.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h)) return hmValue;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  if (!m) return `${h12} ${suffix}`;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  return `${DAY_NAMES[dt.getUTCDay()]}, ${MONTH_NAMES[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}

export function weekRangeLabel(weekStart: string): string {
  const end = addDays(weekStart, 6);
  const a = formatDay(weekStart).replace(/^..., /, "");
  const b = formatDay(end).replace(/^..., /, "");
  return `${a}–${b}`;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildMessage(input: {
  person: Person;
  orgName: string;
  rangeLabel: string;
  appUrl: string;
}): { subject: string; html: string; text: string } {
  const { person, orgName, rangeLabel, appUrl } = input;
  const restaurant = orgName.trim();
  const where = restaurant ? ` at ${restaurant}` : "";
  const weekStartLabel = rangeLabel.split("–")[0].trim() || rangeLabel;
  const removed = person.kind === "cleared";
  const subject = restaurant
    ? (removed
      ? `Your shifts at ${restaurant} changed · ${weekStartLabel}`
      : `Your shifts at ${restaurant} · ${weekStartLabel}`)
    : (removed
      ? `Your shifts this week changed · ${weekStartLabel}`
      : `Your shifts this week · ${weekStartLabel}`);
  let intro = `Here are your shifts${where} for the week of ${rangeLabel}.`;
  if (person.kind === "updated") {
    intro = `Your shifts${where} for the week of ${rangeLabel} were updated.`;
  } else if (removed) {
    intro = `You no longer have shifts scheduled${where} for the week of ${rangeLabel}.`;
  }

  const lines = person.shifts.map((s) => {
    const when = `${formatDay(s.date)} · ${formatTime(s.start)}–${formatTime(s.end)}`;
    return `${when} · ${s.position}`;
  });
  const listHtml = lines.length
    ? `<ul style="padding-left:18px;margin:12px 0;">${lines.map((line) => `<li style="margin:4px 0;">${esc(line)}</li>`).join("")}</ul>`
    : "";
  const listText = lines.length ? `\n\n${lines.map((line) => `• ${line}`).join("\n")}\n` : "\n";

  const html = `<div style="font-family:Inter,Arial,sans-serif;color:#242220;max-width:520px;line-height:1.45;">
  <p>Hi ${esc(person.name)},</p>
  <p>${esc(intro)}</p>
  ${listHtml}
  <p><a href="${esc(appUrl)}" style="color:#332A25;font-weight:600;">Get the Sheek app</a></p>
  <p style="color:#746E69;font-size:12px;margin-top:24px;">Scheduled with Sheek</p>
</div>`;

  const text = `Hi ${person.name},\n\n${intro}${listText}\nGet the Sheek app: ${appUrl}\n\nScheduled with Sheek\n`;
  return { subject, html, text };
}
