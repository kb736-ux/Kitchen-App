import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/stripe-org.ts";
import {
  addDays,
  applySnapshot,
  asSnapshot,
  buildMessage,
  diffWeek,
  groupShifts,
  isMonday,
  weekRangeLabel,
  type Person,
} from "./scheduleLogic.ts";

/**
 * Publish one schedule week and email each affected staff member once.
 *
 * POST JSON: { org_id, week_start }  week_start is the Monday (YYYY-MM-DD).
 * Header: Authorization: Bearer <manager access token>
 *
 * Secrets: RESEND_API_KEY, RESEND_FROM, optional SHEEK_APP_URL.
 * Does not send phone push. Staff shift visibility is unchanged; this only
 * records schedule_publications and sends email.
 *
 * Re-publish compares live shifts to notified_snapshot and emails only people
 * whose day/time/position set changed, including people whose shifts were
 * cleared. Sends that fail (or have no address) are not written into the
 * snapshot, so the next publish retries them.
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json({ error: "Supabase env is not configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Missing authorization" }, 401);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  const caller = userData?.user;
  if (userErr || !caller?.id) {
    return json({ error: "Invalid session" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const orgId = String(body.org_id || "").trim();
  const weekStart = String(body.week_start || "").trim();
  if (!orgId) return json({ error: "org_id is required" }, 400);
  if (!isMonday(weekStart)) {
    return json({ error: "week_start must be a Monday (YYYY-MM-DD)" }, 400);
  }

  const allowed = await callerCanPublish(admin, orgId, caller.id);
  if (!allowed.ok) return json({ error: allowed.error }, allowed.status);

  const weekEnd = addDays(weekStart, 7);
  const { data: shiftRows, error: shiftErr } = await admin
    .from("shifts")
    .select("shift_date, start_time, end_time, position, employee_name, employee_id")
    .eq("org_id", orgId)
    .gte("shift_date", weekStart)
    .lt("shift_date", weekEnd)
    .limit(2000);
  if (shiftErr) {
    console.error("[publish-week] shifts", shiftErr.message);
    return json({ error: "Could not load shifts" }, 500);
  }

  const { data: profileRows, error: profileErr } = await admin
    .from("profiles")
    .select("id, user_id, employee_name, display_name, full_name, first_name, last_name, email")
    .eq("org_id", orgId)
    .limit(2000);
  if (profileErr) {
    console.error("[publish-week] profiles", profileErr.message);
    return json({ error: "Could not load staff" }, 500);
  }

  const { data: orgRow } = await admin.from("orgs").select("name").eq("id", orgId).maybeSingle();
  const orgName = String(orgRow?.name || "").trim();

  const { data: existing, error: existingErr } = await admin
    .from("schedule_publications")
    .select("notified_snapshot")
    .eq("org_id", orgId)
    .eq("week_start", weekStart)
    .maybeSingle();
  if (existingErr) {
    console.error("[publish-week] schedule_publications", existingErr.message);
    return json({
      error: "schedule_publications is missing. Run supabase/schedule-publications.sql in the SQL editor.",
    }, 500);
  }

  const previous = asSnapshot(existing?.notified_snapshot);
  const current = groupShifts(shiftRows || [], profileRows || []);
  const plan = diffWeek(previous, current);

  const needsSend = plan.send.length > 0;
  const resendKey = (Deno.env.get("RESEND_API_KEY") || "").trim();
  const resendFrom = (Deno.env.get("RESEND_FROM") || "").trim();
  if (needsSend && (!resendKey || !resendFrom)) {
    return json({
      error: "Email is not configured. Set Edge Function secrets RESEND_API_KEY and RESEND_FROM.",
    }, 500);
  }

  const appUrl = (Deno.env.get("SHEEK_APP_URL") || "https://sheekapp.com").trim() || "https://sheekapp.com";
  const rangeLabel = weekRangeLabel(weekStart);

  const emailedNames: string[] = [];
  const clearedNames: string[] = [];
  const skippedNoEmail: string[] = [];
  const failed: { name: string; error: string }[] = [];
  const succeeded = new Set<Person>();

  for (const person of plan.send) {
    const email = await resolveEmail(admin, person);
    person.email = email;
    if (!email) {
      skippedNoEmail.push(person.name);
      continue;
    }
    const message = buildMessage({
      person,
      orgName,
      rangeLabel,
      appUrl,
    });
    const send = await sendResend(resendKey, resendFrom, email, message.subject, message.html, message.text);
    if (!send.ok) {
      failed.push({ name: person.name, error: send.error });
      continue;
    }
    succeeded.add(person);
    if (person.kind === "cleared") clearedNames.push(person.name);
    else emailedNames.push(person.name);
  }

  const nextSnapshot = applySnapshot(previous, plan.unchanged, succeeded);
  const publishedAt = new Date().toISOString();
  const { error: upsertErr } = await admin.from("schedule_publications").upsert(
    {
      org_id: orgId,
      week_start: weekStart,
      published_at: publishedAt,
      published_by: caller.id,
      notified_snapshot: nextSnapshot,
    },
    { onConflict: "org_id,week_start" },
  );
  if (upsertErr) {
    console.error("[publish-week] upsert", upsertErr.message);
    return json({
      error: "Emails may have sent, but the publish record could not be saved. Publish again to retry anyone still pending.",
    }, 500);
  }

  return json({
    ok: true,
    week_start: weekStart,
    published_at: publishedAt,
    emailed: emailedNames.length,
    cleared: clearedNames.length,
    unchanged: plan.unchanged.length,
    skipped_no_email: skippedNoEmail,
    failed,
    visibility: "unchanged",
  }, 200);
});

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callerCanPublish(
  admin: ReturnType<typeof createClient>,
  orgId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data: membership, error: memErr } = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (memErr) {
    console.error("[publish-week] org_members", memErr.message);
    return { ok: false, status: 500, error: "Could not verify manager access" };
  }
  const role = String(membership?.role || "").toLowerCase();
  if (membership && (role === "manager" || role === "owner" || role === "admin")) {
    return { ok: true };
  }
  const { data: adminRow } = await admin
    .from("admin_users")
    .select("is_admin")
    .eq("user_id", userId)
    .maybeSingle();
  if (adminRow?.is_admin === true) return { ok: true };
  return { ok: false, status: 403, error: "Only managers can publish this week" };
}

async function resolveEmail(
  admin: ReturnType<typeof createClient>,
  person: Person,
): Promise<string | null> {
  const direct = String(person.email || "").trim().toLowerCase();
  if (direct.includes("@")) return direct;
  if (!person.userId) return null;
  const { data, error } = await admin.auth.admin.getUserById(person.userId);
  if (error || !data?.user?.email) return null;
  const email = data.user.email.trim().toLowerCase();
  return email.includes("@") ? email : null;
}

async function sendResend(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    });
    if (res.ok) return { ok: true };
    const payload = await res.json().catch(() => ({}));
    const message = String((payload as { message?: string }).message || res.statusText || "Email failed");
    console.error("[publish-week] resend", res.status, message);
    return { ok: false, error: "Email provider rejected the message" };
  } catch (err) {
    console.error("[publish-week] resend", err);
    return { ok: false, error: "Email provider could not be reached" };
  }
}
