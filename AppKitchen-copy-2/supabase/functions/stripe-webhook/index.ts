import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { corsHeaders, priceIdToPlan } from "../_shared/stripe-org.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  httpClient: Stripe.createFetchHttpClient(),
});

function firstPriceId(sub: Stripe.Subscription): string | undefined {
  const item = sub.items?.data?.[0];
  return item?.price?.id;
}

async function syncOrgFromSubscription(
  admin: ReturnType<typeof createClient>,
  orgId: string,
  sub: Stripe.Subscription,
) {
  const priceId = firstPriceId(sub);
  const plan = priceIdToPlan(priceId) || String(sub.metadata?.plan || "").toLowerCase();
  const resolvedPlan = ["starter", "growth", "scale"].includes(plan) ? plan : "starter";
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

  const { error } = await admin
    .from("orgs")
    .update({
      stripe_customer_id: customerId || undefined,
      stripe_subscription_id: sub.id,
      stripe_subscription_status: sub.status,
      subscription_plan: resolvedPlan,
    })
    .eq("id", orgId);

  if (error) console.error("[stripe-webhook] org update failed", error);
}

async function findOrgIdByCustomer(
  admin: ReturnType<typeof createClient>,
  customerId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("orgs")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data?.id || null;
}

function normalizePlanValue(p: string): string {
  const v = String(p || "").toLowerCase().trim();
  return ["starter", "growth", "scale"].includes(v) ? v : "starter";
}

/**
 * Marketing-site onboarding: org is created only after Checkout completes.
 * Returns true if this session was handled (do not run legacy checkout handler).
 */
async function completeOnboardingFromCheckout(
  admin: ReturnType<typeof createClient>,
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<boolean> {
  const intentId = String(session.metadata?.onboarding_intent_id || "").trim();
  if (!intentId) return false;

  if (session.mode !== "subscription" || !session.subscription) {
    console.warn("[stripe-webhook] onboarding checkout: not a subscription session");
    return true;
  }

  const { data: intentRow, error: intErr } = await admin
    .from("onboarding_intents")
    .select("*")
    .eq("id", intentId)
    .maybeSingle();

  if (intErr || !intentRow) {
    console.warn("[stripe-webhook] onboarding: intent not found", intentId, intErr?.message);
    return true;
  }

  if (String(intentRow.status) === "completed" && intentRow.org_id) {
    return true;
  }
  if (String(intentRow.status) === "awaiting_signup" && intentRow.org_id) {
    return true;
  }

  const { data: locked, error: lockErr } = await admin
    .from("onboarding_intents")
    .update({ status: "processing" })
    .eq("id", intentId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (lockErr || !locked) {
    const { data: cur } = await admin
      .from("onboarding_intents")
      .select("status, org_id")
      .eq("id", intentId)
      .maybeSingle();
    if (String(cur?.status) === "completed" && cur?.org_id) return true;
    return true;
  }

  const intent = locked;

  const subId = typeof session.subscription === "string"
    ? session.subscription
    : session.subscription.id;
  let sub: Stripe.Subscription;
  try {
    sub = await stripe.subscriptions.retrieve(subId);
  } catch (e) {
    console.error("[stripe-webhook] onboarding: retrieve subscription", e);
    await admin.from("onboarding_intents").update({ status: "failed" }).eq("id", intentId);
    return true;
  }

  const restaurantName = String(intent.restaurant_name || "").trim();

  if (!restaurantName) {
    console.warn("[stripe-webhook] onboarding: missing restaurant name on intent");
    await admin.from("onboarding_intents").update({ status: "failed" }).eq("id", intentId);
    return true;
  }

  const initialPlan = normalizePlanValue(String(intent.plan || ""));

  const { data: orgRow, error: orgErr } = await admin
    .from("orgs")
    .insert({
      name: restaurantName,
      subscription_plan: initialPlan,
    })
    .select("id")
    .single();

  if (orgErr || !orgRow?.id) {
    console.error("[stripe-webhook] onboarding: org insert failed", orgErr);
    await admin.from("onboarding_intents").update({ status: "failed" }).eq("id", intentId);
    return true;
  }

  const orgId = orgRow.id as string;

  await syncOrgFromSubscription(admin, orgId, sub);

  // Auth user + org_members + profiles are created only after payment, via onboard-complete-signup
  // (password set on marketing /onboard/complete.html).
  await admin
    .from("onboarding_intents")
    .update({
      status: "awaiting_signup",
      org_id: orgId,
    })
    .eq("id", intentId);

  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!webhookSecret) {
    return new Response(JSON.stringify({ error: "STRIPE_WEBHOOK_SECRET not set" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response(JSON.stringify({ error: "No signature" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    // Supabase Edge / Deno uses SubtleCrypto — sync constructEvent fails; use async API.
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (e) {
    console.error("[stripe-webhook] signature", e);
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription" && session.subscription) {
          const handledOnboard = await completeOnboardingFromCheckout(admin, stripe, session);
          if (handledOnboard) break;
        }
        if (session.mode !== "subscription" || !session.subscription) break;
        let orgId = (session.metadata?.org_id || "").trim();
        const subId = typeof session.subscription === "string"
          ? session.subscription
          : session.subscription.id;
        const sub = await stripe.subscriptions.retrieve(subId);
        if (!orgId && session.customer) {
          const cid = typeof session.customer === "string" ? session.customer : session.customer.id;
          orgId = (await findOrgIdByCustomer(admin, cid)) || "";
        }
        if (!orgId) {
          console.warn("[stripe-webhook] checkout.session.completed: no org_id");
          break;
        }
        await syncOrgFromSubscription(admin, orgId, sub);
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const sub = event.data.object as Stripe.Subscription;
        let orgId = (sub.metadata?.org_id || "").trim();
        if (!orgId && sub.customer) {
          const cid = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
          orgId = (await findOrgIdByCustomer(admin, cid)) || "";
        }
        if (!orgId) {
          console.warn("[stripe-webhook] subscription event: no org_id", event.type);
          break;
        }
        await syncOrgFromSubscription(admin, orgId, sub);
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        let orgId = (sub.metadata?.org_id || "").trim();
        if (!orgId && sub.customer) {
          const cid = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
          orgId = (await findOrgIdByCustomer(admin, cid)) || "";
        }
        if (!orgId) break;
        await admin
          .from("orgs")
          .update({
            stripe_subscription_id: null,
            stripe_subscription_status: "canceled",
            subscription_plan: "starter",
          })
          .eq("id", orgId);
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error("[stripe-webhook] handler", e);
    return new Response(JSON.stringify({ error: "Webhook handler error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
