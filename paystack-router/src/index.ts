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
//
// IMPORTANT: PagePay's FastAPI mounts every router under the /api/v1
// prefix (see backend/app/main.py:360 `API_PREFIX = "/api/v1"`).
// Without that prefix the request lands on a 404 path — every
// Paystack event would 404 at FastAPI, get wrapped as 200 by the
// router, and silently drop. Always include the full backend path.
const ROUTES: { prefix: string; url: string }[] = [
  {
    prefix: "pp_",
    url: "https://pagepay-fff6.onrender.com/api/v1/payouts/webhook",
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
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      // No placeholder echo — the only valid method for this router
      // is POST. Reject everything else with the literal 405 + body
      // Paystack (or any other caller) can read to understand what
      // went wrong. If you need to test reachability, POST a sample
      // event signed with the same secret the router verifies against.
      return new Response("Method Not Allowed: POST required", {
        status: 405,
        headers: { Allow: "POST" },
      });
    }

    const signature = request.headers.get("x-paystack-signature");
    const rawBody = await request.text();

    // Verify HMAC-SHA512 signature using Paystack secret key. If the
    // secret is not configured on this Worker, refuse with 500 — that's
    // an operator misconfiguration, not a forged request, and the
    // operator needs to see it (a 401 here would silently mask it).
    if (!env.PAYSTACK_SECRET_KEY) {
      console.error("PAYSTACK_SECRET_KEY is not configured on this Worker");
      return new Response("Router misconfigured: PAYSTACK_SECRET_KEY not set", {
        status: 500,
      });
    }

    const valid = await verifySignature(rawBody, signature, env.PAYSTACK_SECRET_KEY);
    if (!valid) {
      console.warn(`Invalid Paystack webhook signature (ref hint in body if available)`);
      return new Response("Invalid webhook signature", {
        status: 401,
      });
    }

    let event: { event?: string; data?: { reference?: string } };
    try {
      event = JSON.parse(rawBody);
    } catch (err) {
      console.warn(`Invalid webhook JSON: ${err}`);
      return new Response(`Invalid JSON body: ${err}`, {
        status: 400,
      });
    }

    const eventName = event.event || "";
    const reference = event?.data?.reference || "";

    // Surface routing misses to Paystack (and the operator's logs) as
    // 502. Returning 200 here would silently swallow real Paystack
    // events — Paystack would stop retrying, the credit would never
    // land, and the operator would have no signal that the ROUTES
    // table needs updating.
    const route = findRoute(reference);
    if (!route) {
      console.error(`No route for reference=${reference} (event=${eventName}). Update ROUTES in src/index.ts.`);
      return new Response(
        `No route configured for reference prefix of "${reference}"`,
        {
          status: 502,
          headers: { "Content-Type": "text/plain" },
        },
      );
    }

    console.log(`Routing ${eventName} ref=${reference} → ${route.url}`);

    // Forward to the project's webhook endpoint with the original
    // signature intact so the backend can verify it again.
    let projectRes: Response;
    try {
      projectRes = await fetch(route.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Paystack-Signature": signature || "",
          "X-Forwarded-Event": eventName,
        },
        body: rawBody,
      });
    } catch (err) {
      // Network/DNS/timeout to the backend. Surface as 502 so Paystack
      // retries and the operator sees the upstream failure in logs.
      console.error(`fetch to ${route.url} threw: ${err}`);
      return new Response(`Upstream fetch failed: ${err}`, {
        status: 502,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const responseData = await projectRes.text();
    console.log(`Project responded ${projectRes.status}: ${responseData}`);

    // Forward the project's actual status code so Paystack sees
    // real outcomes: 200 on success, 401 on signature mismatch, 500
    // on backend failure, etc. Hardcoding 200 here would hide
    // backend errors from Paystack (it interprets 200 as "received"
    // and never retries) — and from the operator's logs.
    // Forward the upstream Content-Type when present; default to
    // JSON for FastAPI's standard {"detail": ...} envelope.
    const upstreamType = projectRes.headers.get("Content-Type");
    return new Response(responseData, {
      status: projectRes.status,
      headers: {
        "Content-Type": upstreamType ?? "application/json",
      },
    });
  },
};
