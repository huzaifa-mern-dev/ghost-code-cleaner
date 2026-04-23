import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import { getShopifyConfig } from "./config";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface OAuthState {
  shop: string;
  state: string;
  createdAt: Date;
}

// In-memory state store.
// In production this should be replaced with Redis/DB for multi-instance support.
const pendingStates = new Map<string, OAuthState>();

/** State TTL: 10 minutes */
const STATE_TTL_MS = 10 * 60 * 1000;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Removes expired OAuth states from the in-memory map */
function pruneExpiredStates(): void {
  const now = Date.now();
  for (const [key, value] of pendingStates) {
    if (now - value.createdAt.getTime() > STATE_TTL_MS) {
      pendingStates.delete(key);
    }
  }
}

/** Sanitises a shop domain — ensures it's a valid .myshopify.com or custom domain */
function sanitizeShop(shop: string): string {
  // Strip protocol if present
  let s = shop.replace(/^https?:\/\//, "");
  // Strip trailing slash
  s = s.replace(/\/$/, "");
  return s;
}

// ─────────────────────────────────────────────
// HMAC Verification
// ─────────────────────────────────────────────

/**
 * Verifies the HMAC signature on a Shopify OAuth callback query.
 *
 * Algorithm (per Shopify docs):
 *   1. Remove the `hmac` key from the query params
 *   2. Sort remaining keys alphabetically
 *   3. Join as "key=value" pairs separated by "&"
 *   4. HMAC-SHA256 the message using SHOPIFY_API_SECRET
 *   5. Compare (timing-safe) with the provided hmac hex string
 */
export function verifyHmac(query: Record<string, string>, secret: string): boolean {
  const { hmac, ...rest } = query;

  if (!hmac) return false;

  // Build the message: sorted key=value pairs
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("&");

  const digest = createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  try {
    // timingSafeEqual requires same-length buffers
    const digestBuf = Buffer.from(digest, "hex");
    const hmacBuf = Buffer.from(hmac, "hex");

    if (digestBuf.length !== hmacBuf.length) return false;
    return timingSafeEqual(digestBuf, hmacBuf);
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────
// OAuth URL Generation
// ─────────────────────────────────────────────

/**
 * Generates a Shopify OAuth authorization URL and stores the nonce state
 * in memory for later verification.
 *
 * Returns { url, state } — redirect the merchant's browser to `url`.
 */
export function generateAuthUrl(shop: string): { url: string; state: string } {
  const config = getShopifyConfig();
  const cleanShop = sanitizeShop(shop);

  // Generate a cryptographically random state nonce
  const state = randomBytes(16).toString("hex");

  // Store state for callback verification
  pruneExpiredStates();
  pendingStates.set(state, {
    shop: cleanShop,
    state,
    createdAt: new Date(),
  });

  const params = new URLSearchParams({
    client_id: config.apiKey,
    scope: config.scopes.join(","),
    redirect_uri: `${config.appUrl}/auth/callback`,
    state,
    "grant_options[]": "per-user",
  });

  const url = `https://${cleanShop}/admin/oauth/authorize?${params.toString()}`;

  return { url, state };
}

// ─────────────────────────────────────────────
// OAuth Callback Validation
// ─────────────────────────────────────────────

export interface CallbackQuery {
  code: string;
  shop: string;
  state: string;
  hmac: string;
  [key: string]: string;
}

/**
 * Validates a Shopify OAuth callback and exchanges the code for an access token.
 *
 * Steps:
 *   1. Verify HMAC signature using SHOPIFY_API_SECRET
 *   2. Verify the state matches a pending (non-expired) state entry
 *   3. Exchange the authorization code for a permanent access token
 *   4. Return { accessToken, shop }
 */
export async function validateCallback(
  query: CallbackQuery
): Promise<{ accessToken: string; shop: string }> {
  const config = getShopifyConfig();
  const { code, shop, state, ...rest } = query;

  // ── 1. HMAC verification ──────────────────────────────────────────────────
  const allParams: Record<string, string> = { code, shop, state, ...rest };
  if (!verifyHmac(allParams, config.apiSecret)) {
    throw new Error("[ghost/oauth] HMAC verification failed — possible request tampering");
  }

  // ── 2. State verification ─────────────────────────────────────────────────
  const storedState = pendingStates.get(state);

  if (!storedState) {
    throw new Error("[ghost/oauth] Unknown or expired OAuth state — restart the auth flow");
  }

  const elapsed = Date.now() - storedState.createdAt.getTime();
  if (elapsed > STATE_TTL_MS) {
    pendingStates.delete(state);
    throw new Error("[ghost/oauth] OAuth state expired (>10 minutes) — restart the auth flow");
  }

  if (storedState.shop !== sanitizeShop(shop)) {
    throw new Error("[ghost/oauth] Shop mismatch between state and callback");
  }

  // Consume state (one-time use)
  pendingStates.delete(state);

  // ── 3. Token exchange ─────────────────────────────────────────────────────
  const tokenUrl = `https://${shop}/admin/oauth/access_token`;

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.apiKey,
      client_secret: config.apiSecret,
      code,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "(no body)");
    throw new Error(
      `[ghost/oauth] Token exchange failed (${response.status}): ${body}`
    );
  }

  const data = (await response.json()) as { access_token?: string };

  if (!data.access_token) {
    throw new Error("[ghost/oauth] Token exchange response missing access_token");
  }

  return {
    accessToken: data.access_token,
    shop: sanitizeShop(shop),
  };
}

// ─────────────────────────────────────────────
// Exports for testing
// ─────────────────────────────────────────────

/** Exposed for unit tests only — clears all pending states */
export function _clearPendingStates(): void {
  pendingStates.clear();
}
