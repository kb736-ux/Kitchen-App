import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/stripe-org.ts";

/**
 * Manager-invited employees: send Supabase "invite" email so the user sets a password
 * (avoids client signInWithOtp magic-link rate limits and matches "create password then login").
 *
 * POST JSON: { email, employee_name, is_manager, org_id, redirect_to }
 * Header: Authorization: Bearer <manager access token>
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing authorization" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  const manager = userData?.user;
  if (userErr || !manager?.id) {
    return new Response(JSON.stringify({ error: "Invalid session" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const email = String(body.email || "").trim().toLowerCase();
  const employeeName = String(body.employee_name || "").trim();
  const isManager = Boolean(body.is_manager);
  const orgId = String(body.org_id || "").trim();
  const redirectTo = String(body.redirect_to || "").trim();

  if (!email || !email.includes("@")) {
    return new Response(JSON.stringify({ error: "Valid email is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!orgId) {
    return new Response(JSON.stringify({ error: "org_id is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!redirectTo) {
    return new Response(JSON.stringify({ error: "redirect_to is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const envOrigins = (Deno.env.get("INVITE_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let redirectUrl: URL;
  try {
    redirectUrl = new URL(redirectTo);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid redirect_to URL" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const origin = redirectUrl.origin;
  const host = redirectUrl.hostname;

  const defaultAllowed =
    origin === "https://app.sheekapp.com" ||
    /^localhost$/i.test(host) ||
    host === "127.0.0.1" ||
    host.endsWith(".netlify.app") ||
    host.endsWith(".sheekapp.com");

  // Env list adds extra origins; default patterns cover Sheek + Netlify + local dev.
  const allowed = defaultAllowed || envOrigins.includes(origin);

  if (!allowed) {
    return new Response(
      JSON.stringify({
        error:
          "redirect_to origin not allowed. Add INVITE_ALLOWED_ORIGINS in Edge Function secrets or deploy from app.sheekapp.com / Netlify.",
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { data: membership, error: memErr } = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", manager.id)
    .maybeSingle();

  if (memErr) {
    console.error("[invite-employee] org_members", memErr);
    return new Response(JSON.stringify({ error: "Could not verify manager access" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const role = String(membership?.role || "").toLowerCase();
  if (!membership || (role !== "manager" && role !== "owner")) {
    return new Response(JSON.stringify({ error: "Only managers can send invites for this restaurant" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: {
      full_name: employeeName || email.split("@")[0],
      kk_invited_org: orgId,
      kk_invited_as_manager: isManager,
    },
  });

  if (inviteErr) {
    const msg = inviteErr.message || "Invite failed";
    const dup = /already|registered|exists/i.test(msg);
    return new Response(
      JSON.stringify({
        error: dup
          ? "That email already has a Sheek account. Ask them to sign in on this page with email and password, or use Forgot password."
          : msg,
      }),
      {
        status: dup ? 409 : 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
