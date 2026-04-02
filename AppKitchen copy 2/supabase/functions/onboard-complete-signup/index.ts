import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { corsHeaders } from "../_shared/stripe-org.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  httpClient: Stripe.createFetchHttpClient(),
});

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

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const sessionId = String(body.session_id || "").trim();
    const password = String(body.password || "");

    if (!sessionId) {
      return new Response(JSON.stringify({ error: "Missing session_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!password || password.length < 6) {
      return new Response(JSON.stringify({ error: "Password must be at least 6 characters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.mode !== "subscription" || session.payment_status !== "paid") {
      return new Response(JSON.stringify({ error: "Checkout is not complete or not paid" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const intentId = String(session.metadata?.onboarding_intent_id || "").trim();
    if (!intentId) {
      return new Response(JSON.stringify({ error: "Invalid checkout session" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: intent, error: intErr } = await admin
      .from("onboarding_intents")
      .select("*")
      .eq("id", intentId)
      .maybeSingle();

    if (intErr || !intent) {
      return new Response(JSON.stringify({ error: "Onboarding session not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (String(intent.status) === "completed" && intent.auth_user_id) {
      return new Response(JSON.stringify({ ok: true, already_completed: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (String(intent.status) !== "awaiting_signup" || !intent.org_id) {
      return new Response(
        JSON.stringify({
          error:
            "This checkout is not ready for signup. If you already finished, try logging in to the dashboard.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const email = String(intent.email || "").trim().toLowerCase();
    const firstName = String(intent.first_name || "").trim();
    const lastName = String(intent.last_name || "").trim();
    const displayName = `${firstName} ${lastName}`.trim();
    const orgId = String(intent.org_id || "").trim();

    if (!email || !orgId) {
      return new Response(JSON.stringify({ error: "Invalid onboarding data" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: displayName,
        kk_manager_first: firstName,
        kk_manager_last: lastName,
      },
    });

    if (createErr || !created?.user?.id) {
      const msg = createErr?.message || "Could not create account";
      const dup = /already|registered|exists/i.test(msg);
      return new Response(
        JSON.stringify({
          error: dup
            ? "That email is already registered. Log in to the dashboard with that email."
            : msg,
        }),
        {
          status: dup ? 409 : 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const userId = created.user.id;

    const { error: omErr } = await admin.from("org_members").insert({
      org_id: orgId,
      user_id: userId,
      role: "manager",
      position: null,
    });
    if (omErr) {
      try {
        await admin.auth.admin.deleteUser(userId);
      } catch (_) {}
      console.error("[onboard-complete-signup] org_members", omErr);
      return new Response(JSON.stringify({ error: "Could not link you to the restaurant. Contact support." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: profErr } = await admin.from("profiles").insert({
      org_id: orgId,
      user_id: userId,
      email: email || null,
      display_name: displayName || email.split("@")[0] || "Manager",
      employee_name: displayName || email.split("@")[0] || "Manager",
      first_name: firstName || null,
      last_name: lastName || null,
    });
    if (profErr) {
      console.error("[onboard-complete-signup] profiles", profErr);
    }

    try {
      await admin.from("admin_users").upsert({ user_id: userId, is_admin: true }, { onConflict: "user_id" });
    } catch (e) {
      console.warn("[onboard-complete-signup] admin_users", e);
    }

    const { error: upErr } = await admin
      .from("onboarding_intents")
      .update({
        auth_user_id: userId,
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", intentId)
      .eq("status", "awaiting_signup");

    if (upErr) {
      console.error("[onboard-complete-signup] intent update", upErr);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[onboard-complete-signup]", e);
    const msg = e instanceof Error ? e.message : "Request failed";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
