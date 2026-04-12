/** Map Stripe Price id → app plan (env STRIPE_PRICE_STARTER / GROWTH / SCALE). */
export function priceIdToPlan(priceId: string | undefined | null): string | null {
  if (!priceId) return null;
  const s = String(priceId).trim();
  const perUser = Deno.env.get("STRIPE_PRICE_PER_USER")?.trim();
  const starter = Deno.env.get("STRIPE_PRICE_STARTER")?.trim();
  const growth = Deno.env.get("STRIPE_PRICE_GROWTH")?.trim();
  const scale = Deno.env.get("STRIPE_PRICE_SCALE")?.trim();
  if (perUser && s === perUser) return "per_user";
  if (starter && s === starter) return "starter";
  if (growth && s === growth) return "growth";
  if (scale && s === scale) return "scale";
  return null;
}

export function planToPriceId(plan: string): string | null {
  const p = String(plan || "").toLowerCase().trim();
  if (p === "per_user") return Deno.env.get("STRIPE_PRICE_PER_USER")?.trim() || null;
  if (p === "starter") return Deno.env.get("STRIPE_PRICE_STARTER")?.trim() || null;
  if (p === "growth") return Deno.env.get("STRIPE_PRICE_GROWTH")?.trim() || null;
  if (p === "scale") return Deno.env.get("STRIPE_PRICE_SCALE")?.trim() || null;
  return null;
}

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
