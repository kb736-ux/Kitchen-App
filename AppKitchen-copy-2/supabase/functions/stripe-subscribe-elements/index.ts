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
    const publishableKey = Deno.env.get("STRIPE_PUBLISHABLE_KEY")?.trim() || "";

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

    if (!["per_user", "starter", "growth", "scale"].includes(plan) || !orgId) {
      return new Response(JSON.stringify({ error: "Invalid plan or org_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!publishableKey) {
      return new Response(
        JSON.stringify({
          error: "Set STRIPE_PUBLISHABLE_KEY (pk_test_... or pk_live_...) in Edge Function secrets.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const priceId = planToPriceId(plan);
    if (!priceId) {
      return new Response(
        JSON.stringify({ error: "Stripe recurring prices not configured (STRIPE_PRICE_* secrets)." }),
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

    const existing = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 20,
    });
    const blocking = existing.data.find((s) =>
      ["active", "trialing", "past_due"].includes(s.status)
    );
    if (blocking) {
      return new Response(
        JSON.stringify({
          error:
            "This organization already has a Stripe subscription. Open Admin → Billing portal to change plan or payment method.",
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: "default_incomplete",
      payment_settings: {
        save_default_payment_method: "on_subscription",
      },
      metadata: { org_id: orgId, plan },
      expand: ["latest_invoice.payment_intent"],
    });

    const invoice = subscription.latest_invoice;
    let clientSecret: string | null = null;
    if (invoice && typeof invoice === "object") {
      const pit = invoice.payment_intent;
      if (pit && typeof pit === "object" && "client_secret" in pit) {
        clientSecret = (pit as Stripe.PaymentIntent).client_secret;
      } else if (typeof pit === "string") {
        const retrieved = await stripe.paymentIntents.retrieve(pit);
        clientSecret = retrieved.client_secret;
      }
    }

    if (!clientSecret) {
      return new Response(
        JSON.stringify({
          error:
            "Could not create a payment step for this subscription (e.g. $0 invoice). Use hosted Checkout or add a non-zero price.",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        clientSecret,
        publishableKey,
        subscriptionId: subscription.id,
        plan,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[stripe-subscribe-elements]", e);
    const msg = e instanceof Error ? e.message : "Subscription setup failed";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
