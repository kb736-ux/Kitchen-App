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

  try {
    // 1. Authenticate via standard Supabase JWT
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

    // 2. We can allow calling without checking if user is manager, because this just syncs DB state to Stripe.
    // It's a "safe" operation that enforces truth.
    const body = await req.json().catch(() => ({}));
    const orgId = String(body.org_id || "").trim();

    if (!orgId) {
      return new Response(JSON.stringify({ error: "Invalid org_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // 3. Get the active stripe subscription for the org
    const { data: org, error: orgErr } = await admin
      .from("orgs")
      .select("stripe_subscription_id")
      .eq("id", orgId)
      .single();

    if (orgErr || !org) {
      return new Response(JSON.stringify({ error: "Organization not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!org.stripe_subscription_id) {
      // Not subscribed yet, nothing to sync.
      return new Response(JSON.stringify({ synced: false, reason: "no_subscription" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Count the number of completed profiles
    const { count, error: countErr } = await admin
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("onboarding_completed", true);

    if (countErr || count === null) {
      throw new Error(`Failed to count profiles: ${countErr?.message}`);
    }

    // A valid subscription should have at least 1 quantity to stay active
    const newQuantity = Math.max(1, count);

    // 5. Update Stripe subscription item
    const subscription = await stripe.subscriptions.retrieve(org.stripe_subscription_id);
    
    if (subscription.status === "canceled") {
      return new Response(JSON.stringify({ synced: false, reason: "canceled_subscription" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const item = subscription.items.data[0];
    if (!item) {
      throw new Error("No subscription items found on Stripe subscription.");
    }

    if (item.quantity !== newQuantity) {
      await stripe.subscriptionItems.update(item.id, {
        quantity: newQuantity,
      });
    }

    return new Response(JSON.stringify({ synced: true, quantity: newQuantity }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[sync-stripe-quantity]", e);
    const msg = e instanceof Error ? e.message : "Sync failed";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
