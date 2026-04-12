import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { corsHeaders, planToPriceId } from "../_shared/stripe-org.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  httpClient: Stripe.createFetchHttpClient(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user?.id) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const plan = String(body.plan || "").toLowerCase().trim();
    const orgId = String(body.org_id || "").trim();
    const successUrl = String(body.success_url || "").trim();
    const cancelUrl = String(body.cancel_url || "").trim();

    if (!["per_user", "starter", "growth", "scale"].includes(plan) || !orgId || !successUrl || !cancelUrl) {
      return new Response(
        JSON.stringify({ error: "Invalid plan, org_id, or return URLs" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const priceId = planToPriceId(plan);
    if (!priceId) {
      return new Response(
        JSON.stringify({
          error:
            "Stripe price not configured. Set STRIPE_PRICE_PER_USER on the function.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: member, error: memErr } = await admin
      .from("org_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memErr || !member || !["manager", "owner"].includes(String(member.role || ""))) {
      return new Response(JSON.stringify({ error: "Not allowed for this organization" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: org, error: orgErr } = await admin
      .from("orgs")
      .select("id, name, stripe_customer_id")
      .eq("id", orgId)
      .single();

    if (orgErr || !org) {
      return new Response(JSON.stringify({ error: "Organization not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let customerId = org.stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email || undefined,
        name: (org.name as string) || undefined,
        metadata: { org_id: orgId },
      });
      customerId = customer.id;
      await admin.from("orgs").update({ stripe_customer_id: customerId }).eq("id", orgId);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl.includes("?") ? `${successUrl}&session_id={CHECKOUT_SESSION_ID}` : `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      client_reference_id: orgId,
      metadata: { org_id: orgId, plan },
      subscription_data: {
        metadata: { org_id: orgId, plan },
      },
      allow_promotion_codes: true,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[stripe-checkout]", e);
    const msg = e instanceof Error ? e.message : "Checkout failed";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
