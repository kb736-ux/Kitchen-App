# Supabase hot-path audit (keep Postgres)

Kenny asked why Supabase screens take a long time to load, and whether to switch databases.

**Recommendation: keep Supabase / Postgres.** The lag is almost certainly client query shape — unbounded `select('*')`, serial waterfalls, and refetch-of-full-histories — not the database engine.

Chat already proved this. PR #8 made Messages fast on the **same** Postgres by loading conversation heads first and hydrating only the open thread (was downloading every `messages` row). Punches are already snappy on the same DB because they query **this week + limit 80**. Switching to Firebase / PlanetScale / anything else would re-implement the same slow patterns on a new vendor.

This document is findings only. Do **not** treat it as a rewrite plan. Smallest fix per hot path is listed below.

---

## Why it feels like “Supabase is slow”

Typical round trip from the phone / manager dashboard to Postgres is tens of milliseconds. What users wait on is:

1. Downloading **every row for the org** (tasks, shifts, recipes JSON) over the network.
2. **Waiting for query A to finish before starting query B** (serial `await`).
3. Doing that again on **poll / app-foreground / identity field change**.
4. Filtering “mine” in JavaScript after the full org table arrived.

Postgres is doing table scans / RLS checks on those fat payloads. A different database would still ship the same bytes and still run the same waterfalls.

PostgREST also silently caps unbounded selects (commonly 1000 rows). So these queries can be both **slow and incomplete**.

---

## Already fixed (do not redo)

| Screen | What was wrong | What PR #8 did |
|---|---|---|
| Web + Expo chat | `select` all `messages` for the org (oldest-first, no limit) before the sidebar could paint. 20s poll + realtime repeated it. | Latest-per-channel heads (RPC `kk_chat_conversation_heads` or 400-row scan). Hydrate **active** thread only, last 80. Poll heads + open thread, not all histories. Index `(org_id, channel_id, created_at DESC)`. |

SQL: `AppKitchen-copy-2/supabase-messages-chat-heads.sql` — run in the SQL editor if not already applied.

---

## Ranked root causes

### P0 — first paint blocked on full org histories

These are the chat-before-#8 anti-pattern on other screens. Fix these before anything else.

#### 1. Expo Tasks / Home urgent card — download every task, then filter “mine”

**Files:** `MyReactNativeApp/App.js` (`fetchTasks` around lines 722–826)

```js
supabase.from('profiles').select('id, employee_name, ...').eq('org_id', oid),  // no limit
supabase.from('tasks').select('*').eq('org_id', oid).order('created_at'),     // no limit, all columns
```

Then JS filters to the signed-in employee and to org-wide urgent rows. First paint of Tasks **and** the Home urgent card wait on the full table.

Refetched whenever identity fields change (`employeeId`, `employeeName`, `displayName`, first/last, email, profile cache) — around 954–975 — and again on every app foreground (around 680–688).

**Smallest fix:**

- Tasks list: `select('id, text, status, is_urgent, created_at, completed_at, shift_id, employee_id, employee_name')` with a server filter on this employee plus a hard `limit` (e.g. 200 open rows).
- Home urgent: separate query `.eq('is_urgent', true).neq('status','completed').limit(20)` — do not derive it from the full org dump.
- Cache profiles for the org (they barely change); do not re-select them on every task poll.

#### 2. Expo Schedule — two years of every employee’s shifts, `select('*')`

**Files:** `MyReactNativeApp/components/SchedulePage.js`

- `fetchShifts` (around 255–293): `shifts.select('*').eq('org_id').gte(today-365).lte(today+365)` — **all staff**, all columns, about 730 days. Then `myShifts` filters in JS (around 336–345). Loading spinner stays up until that lands.
- A second month-grid fetch (around 216–239) also `select('*')` for the visible month (all staff again).
- `fetchOrgProfiles` is fine (narrow columns, `limit(400)`).

The month calendar only needs **this employee’s dates**. Roster-on-tap already does a tight per-day query (around 625–636).

**Smallest fix (same idea as chat heads):**

- Calendar dots: `select('id, shift_date, start_time, end_time, position, employee_name, employee_id')` for **the visible month only**, still org-scoped if you need coworker dots, **or** filter server-side to this employee for “my schedule”.
- Drop the ±365 day org-wide dump. List of upcoming shifts can be `.gte(today).limit(40)` for this employee.
- Do not `select('*')`.

#### 3. Web Home dashboard — serial waterfall, full `tasks` table twice

**Files:** `KennyKitchenWeb/script.js` (`supabase-ready` around 2192–2237), `KennyKitchenWeb/employees.js` (`loadEmployeePositionsFromSupabase` around 114–138)

On `supabase-ready` the home page does, **in series**:

1. `await loadEmployeePositionsFromSupabase()` → `employee_positions` (all) + `profiles` (all) + `shifts.employee_name` for **the last year, limit 4000**.
2. `await loadTodayShifts()` (around 2053–2072) which **again** `tasks.select('*').eq('org_id')` with no limit, plus today’s shifts + all `employee_positions`.
3. `await fetchTasksForOrgOrdered()` (around 1252–1261) which is **another** `tasks.select('*').eq('org_id')` with no limit.
4. `loadUrgentTasks()` — a third tasks query (this one is at least filtered `is_urgent`).

First paint of “on shift” / Kitchen Progress waits for all of that.

**Smallest fix:**

- One `Promise.all` of: today’s shifts, open tasks for today (or `limit` + not completed), profiles/positions **without** the 4000-row shift-name scan.
- Stop calling `fetchTasksForOrgOrdered` after `loadTodayShifts` already pulled every task.
- Team overview only needs **today’s** shifts + task counts for people on those shifts — query `tasks` with `.in('shift_id', todayIds)` or `.gte('created_at', today)`.

#### 4. Web Scheduling open — the worst waterfall

**Files:** `KennyKitchenWeb/scheduling.js`

Two independent `supabase-ready` handlers both run:

**Handler A (around 727–744)**

1. `await cleanupPastShiftRequests()` (around 119–128) — `shifts.select('id, shift_date').eq(org).lt(shift_date, today)` with **no limit** (every past shift ever), then delete related requests.
2. Pending-request count.
3. `await updateScheduleMatrixAndSync()` → `renderScheduleMatrix` (around 1697) which **again** `await loadEmployeePositionsFromSupabase()` (4000 shift names + all profiles) then week shifts then **all approved time-off ever** (`fetchApprovedTimeOffRequestsForOrg` around 411–419).
4. `syncSupabaseShiftsToGrid` (around 813) is actually good (current week only) — but it waits behind the cleanup + roster.

**Handler B (around 4723–4772)**

1. `await loadEmployeePositionsFromSupabase()` **again**.
2. `await populateEmployeeSelectFromOrg()` (around 2238) which reloads positions + `buildEmployeePositionDisplayLabelMap` (profiles + positions **again**).
3. `await populatePositionSelect()` (around 2297–2323) — all `employee_positions`, then **`shifts.select('position').eq('org_id')` with no date filter** (every shift ever, just to collect unique position strings).
4. `tasks.select('*').eq('org_id')` with no limit (around 4735–4738).
5. `updateScheduleMatrixAndSync()` **a third time**.

The week grid itself is a bounded query. Opening the page does not feel like that because of the serial extras.

**Smallest fix:**

- One boot function. Parallel: week shifts, roster (profiles + employee_positions only), pending request count.
- Delete `populatePositionSelect`’s all-time shifts scan — derive positions from `employee_positions` + this week’s rows.
- `cleanupPastShiftRequests`: don’t select every past shift; delete `shift_requests` where related shift_date is in the past in SQL, or skip on every page load (run rarely).
- Tasks in scheduling: by `shift_id` when a card is open (already done in `loadExistingTasksForEmployee` around 3937), not the whole org table at boot.

---

### P1 — extra round trips, polls, missing indexes

#### 5. Expo Home / “next shift” — all future shifts to find one row

**File:** `MyReactNativeApp/App.js` `checkTodayShift` (around 839–929)

Serial: all org profiles → all of **today’s** shifts `select('*')` → if none for me, `shifts.select('*').gt('shift_date', today).order('shift_date')` **with no limit**, then `.find()` the first match in JS.

**Smallest fix:** today’s query is OK if you drop `*`. Upcoming: `.gt('shift_date', today).order('shift_date').limit(30)` then pick the first match, or filter `employee_id` / names server-side. Don’t download the rest of the year.

Triggered from a large identity `useEffect` (around 933–952) so it repeats as names hydrate.

#### 6. Expo 10s badge poll still touches `messages`

**File:** `MyReactNativeApp/App.js` (around 694–700, `fetchChatUnreadDot` around 498–523)

Every 10s: last 120 announcements + last **200 messages** (`select created_at, sender, employee_id`), just to flip a nav dot.

Chat itself now polls heads every 20s (`ChatPage.js` around 246–253) — that’s fine. The **app shell** should not re-download 200 messages.

**Smallest fix:** `select id` with `.gt('created_at', seenAt).limit(1)` (exists check), or reuse chat heads. Don’t pull 200 rows.

#### 7. Recipes — fat JSON + serial N+1 status writes

**Web:** `KennyKitchenWeb/recipes.js`

- `loadRecipesFromSupabase` (around 150–155): `recipes.select('*')` (ingredients + steps JSON for every recipe) before first paint.
- Then `await loadDishesFromSupabase` (schema fallbacks, but single-flight — OK).
- Then `syncAllRecipeStatuses` (around 263–269): **one UPDATE per recipe**, awaited in a loop.

**Expo:** `MyReactNativeApp/components/RecipesPage.js` `fetchRecipes` (around 73–82) pulls `ingredients, steps` for the list screen.

**Smallest fix:** list query `select('id, name, status, yield_amount, yield_unit')`. Fetch ingredients/steps when a recipe is opened. Drop the boot-time status UPDATE loop (compute active in JS, or one SQL update from dishes).

#### 8. Identity refetch storms (Expo)

`HomePage.js` (around 98–120), `SchedulePage.js` (around 202–209), and `App.js` task/shift effects all re-run the fat queries whenever `employeeName` / `displayName` / `firstName` / `lastName` / profile cache change. Those fields populate **after** the first fetch, so users pay for 2–3 full downloads on open.

**Smallest fix:** wait until `authLoading === false` **and** `employeeId` is known, then fetch once. Don’t list every name string in the dependency array.

#### 9. Indexes implied by filters (not a vendor switch)

Repo SQL only adds indexes for chat heads, punches, `tasks.shift_id`, and task-transfer. Almost every hot query filters `org_id` plus a date/status/employee column with **no matching index in-repo**.

Optional script: `AppKitchen-copy-2/supabase-hotpath-indexes.sql` (run in SQL editor after backup). Indexes help the **bounded** queries; they will **not** make `select('*')` of two years of shifts feel fast — still fix the client.

Likely useful:

| Table | Index | Used by |
|---|---|---|
| `shifts` | `(org_id, shift_date)` | week/month grids, today roster |
| `shifts` | `(org_id, employee_name, shift_date)` | “my schedule” once filtered server-side |
| `tasks` | `(org_id, created_at)` | dashboard / fetchTasks |
| `tasks` | `(org_id, employee_id)` | Expo “mine” |
| `tasks` | `(org_id, is_urgent)` WHERE open | Home urgent card |
| `profiles` | `(org_id, user_id)` | identity, roster |
| `employee_positions` | `(org_id, employee_name)` | roster |
| `shift_requests` | `(org_id, status, created_at DESC)` | pending requests |
| `notifications` | `(org_id, type, read)` | badge counts (already `head: true` — good) |
| `announcements` | `(org_id, created_at DESC)` | home + chat |

Punches already have `(org_id, punched_at DESC)` in `supabase-clock-in-out.sql`.

#### 10. Duplicate profile lookups (same table, many callers)

Not classic per-row N+1 in a loop (except recipe status). Worse: **the same org profiles query is issued 3–6 times per page open** from different helpers that don’t share a cache:

- `loadEmployeePositionsFromSupabase`
- `buildProfileDisplayLabelMap` (`scheduling.js` around 2156)
- `buildEmployeePositionDisplayLabelMap` (around 2190)
- `buildEmployeesProfileDisplayLabelMap` (`employees.js` around 718)
- Expo `fetchTasks` + `checkTodayShift` + `SchedulePage.fetchOrgProfiles` + `HomePage.fetchWeekShifts`

**Smallest fix:** one in-memory `window._orgProfiles` / React context loaded once per session.

---

### P2 — real but smaller

| Item | Where | Notes | Smallest fix |
|---|---|---|---|
| Profile screen serial lookups | `ProfilePage.js` around 112–178 | 5 sequential `profiles.select('*')` fallbacks (user_id, email, global, id, employee_name) then admin_profiles. | Match `App.js` `fetchProfileData` (around 365): `Promise.all` the candidates. Select columns, not `*`. |
| Expo identity boot | `EmployeeContext.js` `loadBestProfile` around 108–150 | 5 parallel profile queries (OK) then optional `.limit(200)` name scan. | Stop after first hit; skip the 200-row scan when `user_id` matched. |
| Home time-off dots | `HomePage.js` `fetchApprovedTimeOffWeek` around 267–272 | All approved time-off for the org, clip to this week in JS. | Filter overlaps in SQL (`time_off_end_date >= weekStart AND time_off_start_date <= weekEnd`). |
| Web time-off | `fetchApprovedTimeOffRequestsForOrg` | All-time approved rows plus a profiles map, called from matrix **and** sync. | Same date overlap filter; cache the map. |
| `fetchEmployeeShiftsInDateRange` | `scheduling.js` around 469–476 | All org shifts in range, filter one employee in JS. | Filter `employee_name` / id on the server. |
| Notifications bell | `script.js` around 1273–1280 | Last 400 `select('*')`, then JS date filter (column-missing workaround). | Select the columns the bell uses. 400 is an OK cap. |
| Web notif poll | `script.js` around 1358–1365 | Re-fetches 400 notifications every 30s. | Poll count / id since last seen. |
| Shift-request panel | `scheduling.js` `loadShiftRequests` | Pending `select('*')` (OK size) then a debug “all statuses limit 10” extra query plus profiles. | Drop the debug query in production. |
| Employees page dual boot | `employees.js` around 651 and 1731 | Roster loader **and** `org_members` with nested `profiles(*)`. | One handler. Nested `profiles(*)` is an extra join — select what the UI needs. |
| Chat 20s poll | `chat.js` / `ChatPage.js` | Heads + open thread. Acceptable. | Leave it. Confirm `kk_chat_conversation_heads` is deployed so the 400-row fallback is not the steady state. |
| `__DEV__` boot probes | `App.js` around 604–635 | Serial 5 extra RLS test queries. | Dev only; ignore. |
| Inventory / dishes schema fallbacks | `inventory.js`, `recipes.js` | Sequential select shapes until one works. | One-time; not a hot path once schema is known. Cache the working column list. |

---

## Per-screen scorecard

| Screen | Blocks first paint on full dataset? | Unbounded `select('*')` / org scan? | Serial waterfall? | Poll of full history? | Switch DB would help? |
|---|---|---|---|---|---|
| **Chat** (after #8) | No | No (heads + 80) | No (parallel) | Heads only | No |
| **Expo Tasks / Home urgent** | **Yes** | **Yes — all tasks** | Profiles parallel with tasks, then identity re-fetch | Foreground refetch | No |
| **Expo Schedule** | **Yes** | **Yes — ±365d all staff `*`** | Profiles then shifts | Pull-to-refresh | No |
| **Expo Home week dots** | Mild | Week-bounded (good) | Parallel week+profiles | On identity change | No |
| **Expo next-shift card** | Yes if no today | **All future shifts** | Profiles → today → upcoming | Identity effect | No |
| **Expo punches** | No | Week + user filter | Flag then punches | 30s tick is local clock | No |
| **Web Home** | **Yes** | **All tasks ×2 + 4000 shift names** | **Long serial boot** | 30s notifs (400 rows) | No |
| **Web Scheduling** | **Yes** | Past shifts, all-time positions, all tasks | **Two boot handlers, 3× roster** | No | No |
| **Web Employees** | Roster wait | Positions + profiles + 4000 names | Two `supabase-ready` handlers | No | No |
| **Recipes** | Yes | All recipes `*` / JSON | Recipes → dishes → N+1 updates | No | No |
| **Profiles** | Mild | `select('*')` but limited | Serial fallbacks (Expo page) | No | No |
| **Punches (web)** | No | Week, limit 80, columns listed | Flag then punches | No | No |

---

## Would switching databases help?

**No.** Evidence from this repo:

1. **Same Postgres, chat is fast after query-shape change** (PR #8). The database did not change; the download did.
2. **Same Postgres, punches are fine** (`timeClock.js` week range + `limit(80)`; Expo `fetchWeekPunches` week + `user_id`). That is the control group.
3. The slow screens download **application data the UI does not render** (other employees’ year of shifts, completed tasks from months ago, recipe step JSON on the list). No engine makes that payload small.
4. Serial `await` is **network RTT × N**. Firebase or PlanetScale would add the same RTT (often more, if you lose PostgREST’s one-round-trip filters).
5. RLS already exists and was painful to get right (`rls-fix-org-members-shifts.sql`). A vendor move reopens auth isolation for no speed win.
6. Indexes are cheap on the current DB. They are not a reason to migrate.

Migrate only if you outgrow **product** limits (auth, storage, realtime quotas) — not because Schedule takes several seconds to paint.

---

## Suggested order (small PRs, not a rewrite)

1. Confirm chat RPC is deployed (`kk_chat_conversation_heads`). If not, run `supabase-messages-chat-heads.sql`.
2. Run `supabase-hotpath-indexes.sql` (optional, safe `IF NOT EXISTS`).
3. Expo `fetchTasks` + Home urgent: column list + server filter + stop identity refetch storm.
4. Expo `SchedulePage.fetchShifts`: visible month / my rows only; drop ±365 org dump.
5. Web Home: one parallel boot; delete the duplicate all-tasks fetch.
6. Web Scheduling: one boot; delete all-time `shifts.select('position')` and all-past-shifts cleanup-on-every-load.
7. Recipes list: drop JSON columns and the N+1 status updates.

Each item is a PR the size of #8, not a mega-diff.

---

## Out of scope (unchanged)

New DB vendor, Firebase/PlanetScale, full rewrite, geofence, open shifts, payroll.
