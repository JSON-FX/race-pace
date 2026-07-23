import { serviceClient } from "../_shared/supabase.ts";
import { confirmPayment } from "../_shared/confirm.ts";
import { paymongoConfigured } from "../_shared/paymongo.ts";

function page(body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><title>Sandbox checkout</title></head>` +
    `<body style="font-family:-apple-system,system-ui,sans-serif;margin:0;padding:32px;background:#f5f5f7;color:#1d1d1f">${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

// Navigating to the app's custom scheme closes the auth session and returns control to the app.
// The <script> auto-returns; the <a> is a manual fallback.
function bounce(returnUrl: string, status: string): Response {
  const target = returnUrl + (returnUrl.includes("?") ? "&" : "?") + "status=" + status;
  return page(
    `<h2>${status === "paid" ? "Payment complete" : "Payment cancelled"}</h2>` +
    `<p>Returning to the app…</p>` +
    `<p><a href="${target}">Tap here if it doesn't return automatically.</a></p>` +
    `<script>window.location.href=${JSON.stringify(target)}</script>`,
  );
}

// DEV ONLY. Stands in for a PayMongo-hosted checkout page while PayMongo is not wired.
Deno.serve(async (req) => {
  // Real-money safety: this sandbox confirms payments without a real charge — never
  // reachable where PayMongo is configured (hosted). Local dev (no key) still works.
  if (paymongoConfigured()) return page("<h2>Not available</h2>", 404);

  const u = new URL(req.url);
  const rid = u.searchParams.get("rid") ?? "";
  const ret = u.searchParams.get("return") ?? "";
  const action = u.searchParams.get("action");
  if (!rid || !ret) return page("<h2>Invalid checkout link</h2>", 400);

  if (action === "pay") {
    await confirmPayment(rid, "gcash", { source: "fake-checkout" });
    return bounce(ret, "paid");
  }
  if (action === "cancel") return bounce(ret, "cancel");

  const db = serviceClient();
  const { data: reg } = await db
    .from("registrations")
    .select("total_amount, events(name), categories(label)")
    .eq("id", rid)
    .maybeSingle();
  if (!reg) return page("<h2>Registration not found</h2>", 404);

  const ev = (reg.events as { name: string } | null)?.name ?? "Event";
  const cat = (reg.categories as { label: string } | null)?.label ?? "";
  const peso = "₱" + (reg.total_amount / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
  // Build the action links from the same env the provider used, so they don't depend on
  // how `functions serve` presents req.url's path.
  const fnBase = Deno.env.get("PUBLIC_FUNCTIONS_URL") ?? `${u.origin}/functions/v1`;
  const base = `${fnBase}/fake-checkout?rid=${encodeURIComponent(rid)}&return=${encodeURIComponent(ret)}`;
  return page(
    `<h1 style="font-size:22px;margin:0 0 4px">${ev}</h1>` +
    `<p style="color:#6e6e73;margin:0">${cat}</p>` +
    `<div style="font-size:34px;font-weight:700;margin:16px 0">${peso}</div>` +
    `<p style="color:#6e6e73;font-size:14px">GCash / Card / Maya — <b>sandbox</b>. No real charge.</p>` +
    `<a href="${base}&action=pay" style="display:block;text-align:center;background:#0066cc;color:#fff;padding:16px;border-radius:9999px;text-decoration:none;font-weight:600;margin:24px 0 12px">Pay ${peso}</a>` +
    `<a href="${base}&action=cancel" style="display:block;text-align:center;color:#0066cc;text-decoration:none">Cancel</a>`,
  );
});
