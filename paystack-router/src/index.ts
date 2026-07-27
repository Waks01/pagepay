/**
 * paystack-webhook-router
 *
 * One Paystack webhook URL → multiple project backends.
 *
 * How it works:
 *  1. Each project stamps a unique prefix on payment references, e.g.
 *       pp_wallet_42_abc123
 *       salon_88_xyz789
 *       tutor_11_def456
 *  2. Paystack sends the webhook to this single router URL.
 *  3. We inspect the reference prefix, look up the target URL, and
 *     forward the raw payload + signature.
 *  4. The project backend processes it normally and returns 200.
 *
 * Setup:
 *  1. Add your project's prefix + webhook URL to ROUTES below.
 *  2. Deploy:  wrangler deploy
 *  3. Set PAYSTACK_SECRET_KEY as a secret:
 *       wrangler secret put PAYSTACK_SECRET_KEY
 *  4. Paste the deployed URL into Paystack dashboard → Webhooks.
 */

interface Env {
  PAYSTACK_SECRET_KEY: string;
}

// ── Routing table ─────────────────────────────────────────────────────
// Add a new project here. The router forwards to the first matching prefix.
const ROUTES: { prefix: string; url: string }[] = [
  {
    prefix: "pp_",
    url: "https://pagepay-fff6.onrender.com/payouts/webhook",
  },
  // {
  //   prefix: "salon_",
  //   url: "https://salon-api.yourapp.com/webhooks/paystack",
  // },
  // {
  //   prefix: "tutor_",
  //   url: "https://tutor-api.yourapp.com/webhooks/paystack",
  // },
];

// ── Helpers ───────────────────────────────────────────────────────────

function findRoute(reference: string): { prefix: string; url: string } | null {
  const ref = (reference || "").trim().toLowerCase();
  return ROUTES.find((r) => ref.startsWith(r.prefix)) || null;
}

async function verifySignature(
  body: string,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature || !secret) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return signature.trim().toLowerCase() === expected;
}

// ── Handler ───────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: PAYSTACK_SECRET_KEY extends string ? Env : never): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const signature = request.headers.get("x-paystack-signature");
    const rawBody = await request.text();

    // Verify HMAC-SHA512 signature using Paystack secret key.
    const valid = await verifySignature(rawBody, signature, env.PAYSTACK_SECRET_KEY);
    if (!valid) {
      console.warn("Invalid Paystack webhook signature");
      return new Response("Invalid signature", { status: 401 });
    }

    let event: { event?: string; data?: { reference?: string } };
    try {
      event = JSON.parse(rawBody);
    } catch {
      console.warn("Invalid webhook JSON");
      return new Response("Invalid JSON", { status: 400 });
    }

    const eventName = event.event || "";
    const reference = event?.data?.reference || "";

    // Log non-routable events so you can debug missing prefixes.
    const route = findRoute(reference);
    if (!route) {
      console.log(`No route for reference: ${reference} (event: ${eventName})`);
      // Still return 200 so Paystack stops retrying.
      return new Response(JSON.stringify({ received: true, handled: false, reason: "no_route" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`Routing ${eventName} ref=${reference} → ${route.url}`);

    // Forward to the project's webhook endpoint with the original
    // signature intact so the backend can verify it again if needed.
    const projectRes = await fetch(route.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Paystack-Signature": signature || "",
        "X-Forwarded-Event": eventName,
      },
      body: rawBody,
    });

    const responseData = await projectRes.text();
    console.log(`Project responded ${project.status}: ${responseData}`);

    return new Response(responseData, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
};
