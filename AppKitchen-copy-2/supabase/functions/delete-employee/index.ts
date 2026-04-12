import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/stripe-org.ts";

/**
 * delete-employee Edge Function
 * ────────────────────────────────
 * Deletes ALL data for an employee and disables their auth account.
 *
 * Expects JSON body:
 *   { org_id: string, employee_name: string, user_id?: string }
 *
 * Must be called by an authenticated admin/manager.
 */
Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Verify the caller is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller identity via their JWT
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const orgId = body.org_id;
    const employeeName = (body.employee_name || "").trim();
    let userId = (body.user_id || "").trim() || null;

    if (!orgId || !employeeName) {
      return new Response(JSON.stringify({ error: "org_id and employee_name required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller is admin/manager for this org
    const { data: callerMember } = await admin
      .from("org_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", caller.id)
      .maybeSingle();

    const callerRole = (callerMember?.role || "").toLowerCase();
    const { data: callerAdmin } = await admin
      .from("admin_users")
      .select("is_admin")
      .eq("user_id", caller.id)
      .maybeSingle();

    const isAllowed =
      ["manager", "owner", "admin"].includes(callerRole) ||
      callerAdmin?.is_admin === true;

    if (!isAllowed) {
      return new Response(JSON.stringify({ error: "Only managers/admins can delete employees" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up the employee's user_id from profiles if not provided
    if (!userId) {
      const { data: prof } = await admin
        .from("profiles")
        .select("user_id")
        .eq("org_id", orgId)
        .ilike("employee_name", employeeName)
        .maybeSingle();
      userId = prof?.user_id || null;
    }

    const deleted: string[] = [];

    // 1. Delete employee_positions
    const { error: e1 } = await admin
      .from("employee_positions")
      .delete()
      .eq("org_id", orgId)
      .ilike("employee_name", employeeName);
    if (!e1) deleted.push("employee_positions");

    // 2. Delete shifts (by employee_name)
    const { error: e2 } = await admin
      .from("shifts")
      .delete()
      .eq("org_id", orgId)
      .ilike("employee_name", employeeName);
    if (!e2) deleted.push("shifts");

    // 3. Delete tasks (by employee_name if column exists)
    try {
      const { error: e3 } = await admin
        .from("tasks")
        .delete()
        .eq("org_id", orgId)
        .ilike("employee_name", employeeName);
      if (!e3) deleted.push("tasks");
    } catch (_) { /* column may not exist */ }

    // 4. Delete shift_requests
    try {
      const { error: e4 } = await admin
        .from("shift_requests")
        .delete()
        .eq("org_id", orgId)
        .ilike("employee_name", employeeName);
      if (!e4) deleted.push("shift_requests");
    } catch (_) { /* table may not exist */ }

    // 5. Delete notifications
    try {
      const { error: e5 } = await admin
        .from("notifications")
        .delete()
        .eq("org_id", orgId)
        .ilike("employee_name", employeeName);
      if (!e5) deleted.push("notifications");
    } catch (_) { /* column may not exist */ }

    // 6. Delete push_tokens
    try {
      const { error: e6 } = await admin
        .from("push_tokens")
        .delete()
        .eq("org_id", orgId)
        .ilike("employee_name", employeeName);
      if (!e6) deleted.push("push_tokens");
    } catch (_) { /* table may not exist */ }

    // 7. Delete messages sent by this employee
    try {
      const { error: e7 } = await admin
        .from("messages")
        .delete()
        .eq("org_id", orgId)
        .ilike("sender", employeeName);
      if (!e7) deleted.push("messages");
    } catch (_) { /* may fail */ }

    if (userId) {
      // 8. Delete org_members
      const { error: e8 } = await admin
        .from("org_members")
        .delete()
        .eq("org_id", orgId)
        .eq("user_id", userId);
      if (!e8) deleted.push("org_members");

      // 9. Delete admin_users
      try {
        const { error: e9 } = await admin
          .from("admin_users")
          .delete()
          .eq("user_id", userId);
        if (!e9) deleted.push("admin_users");
      } catch (_) {}

      // 10. Delete admin_profiles
      try {
        const { error: e10 } = await admin
          .from("admin_profiles")
          .delete()
          .eq("user_id", userId);
        if (!e10) deleted.push("admin_profiles");
      } catch (_) {}
    }

    // 11. Delete profiles
    const { error: e11 } = await admin
      .from("profiles")
      .delete()
      .eq("org_id", orgId)
      .ilike("employee_name", employeeName);
    if (!e11) deleted.push("profiles");

    // 12. Delete the auth user (prevents login entirely)
    if (userId) {
      const { error: authErr } = await admin.auth.admin.deleteUser(userId);
      if (authErr) {
        console.warn("[delete-employee] auth.deleteUser failed:", authErr.message);
      } else {
        deleted.push("auth.users");
      }
    }

    console.log(`[delete-employee] Deleted ${employeeName} from org ${orgId}: ${deleted.join(", ")}`);

    return new Response(
      JSON.stringify({ success: true, deleted, employee_name: employeeName, user_id: userId }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[delete-employee] Error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
