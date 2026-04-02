import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { corsHeaders, planToPriceId } from "../_shared/stripe-org.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  httpClient: Stripe.createFetchHttpClient(),
});

function normalizePlan(p: string): string | null {
  const v = String(p || "").toLowerCase().trim();
  return ["starter", "growth", "scale"].includes(v) ? v : null;
}

/** Allow redirects back to the manager app after Checkout (comma-separated URL prefixes). */
function isAllowedRedirectUrl(url: string): boolean {
  const raw = (Deno.env.get("ONBOARD_ALLOWED_URL_PREFIXES") || "").trim();
  const defaults =
    "https://app.sheekapp.com,http://localhost,http://127.0.0.1,file:";
  const prefixes = (raw || defaults).split(",").map((s) => s.trim()).filter(Boolean);
  const u = String(url || "").trim();
  if (!u) return false;
  return prefixes.some((p) => u.startsWith(p));
}

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
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const firstName = String(body.first_name || "").trim();
    const lastName = String(body.last_name || "").trim();
    const restaurantName = String(body.restaurant_name || "").trim();
    const plan = normalizePlan(String(body.plan || ""));
    const successUrl = String(body.success_url || "").trim();
    const cancelUrl = String(body.cancel_url || "").trim();

    if (!email || !firstName || !lastName || !restaurantName || !plan) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
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
    if (!isAllowedRedirectUrl(successUrl) || !isAllowedRedirectUrl(cancelUrl)) {
      return new Response(JSON.stringify({ error: "Invalid success_url or cancel_url" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!successUrl.includes("{CHECKOUT_SESSION_ID}")) {
      return new Response(
        JSON.stringify({ error: "success_url must include {CHECKOUT_SESSION_ID}" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const priceId = planToPriceId(plan);
    if (!priceId) {
      return new Response(
        JSON.stringify({
          error:
            "Stripe price not configured. Set STRIPE_PRICE_STARTER, STRIPE_PRICE_GROWTH, STRIPE_PRICE_SCALE on the function.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const displayName = `${firstName} ${lastName}`.trim();
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
            ? "That email is already registered. Log in to the dashboard instead."
            : msg,
        }),
        {
          status: dup ? 409 : 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const userId = created.user.id;

    const { data: intentRow, error: insErr } = await admin
      .from("onboarding_intents")
      .insert({
        email,
        first_name: firstName,
        last_name: lastName,
        restaurant_name: restaurantName,
        plan,
        auth_user_id: userId,
        status: "pending",
      })
      .select("id")
      .single();

    if (insErr || !intentRow?.id) {
      try {
        await admin.auth.admin.deleteUser(userId);
      } catch (_) {}
      return new Response(
        JSON.stringify({ error: insErr?.message || "Could not start checkout" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const intentId = intentRow.id as string;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: intentId,
      metadata: {
        onboarding_intent_id: intentId,
        plan,
        auth_user_id: userId,
      },
      subscription_data: {
        metadata: {
          onboarding_intent_id: intentId,
          plan,
          auth_user_id: userId,
        },
      },
      allow_promotion_codes: true,
    });

    if (!session?.id || !session.url) {
      try {
        await admin.from("onboarding_intents").delete().eq("id", intentId);
      } catch (_) {}
      try {
        await admin.auth.admin.deleteUser(userId);
      } catch (_) {}
      return new Response(JSON.stringify({ error: "Stripe session could not be created" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin
      .from("onboarding_intents")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", intentId);

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[stripe-onboard-checkout]", e);
    const msg = e instanceof Error ? e.message : "Checkout failed";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
