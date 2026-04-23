// ─────────────────────────────────────────────
// Shopify App Configuration
// ─────────────────────────────────────────────

export interface ShopifyConfig {
  apiKey: string;
  apiSecret: string;
  appUrl: string;
  scopes: string[];
}

const REQUIRED_SCOPES = [
  "read_themes",
  "write_themes",
  "read_script_tags",
  "write_script_tags",
] as const;

/**
 * Reads Shopify app configuration from environment variables.
 * Throws a descriptive error if any required variable is missing.
 *
 * Required env vars:
 *   SHOPIFY_API_KEY     — public API key for the Shopify app
 *   SHOPIFY_API_SECRET  — secret key used for HMAC verification and token exchange
 *   SHOPIFY_APP_URL     — public URL of this app (e.g. https://app.example.com)
 *   SHOPIFY_SCOPES      — comma-separated OAuth scopes (defaults to all required scopes)
 */
export function getShopifyConfig(): ShopifyConfig {
  const missing: string[] = [];

  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecret = process.env.SHOPIFY_API_SECRET;
  const appUrl = process.env.SHOPIFY_APP_URL;

  if (!apiKey) missing.push("SHOPIFY_API_KEY");
  if (!apiSecret) missing.push("SHOPIFY_API_SECRET");
  if (!appUrl) missing.push("SHOPIFY_APP_URL");

  if (missing.length > 0) {
    throw new Error(
      `[ghost/shopify] Missing required environment variables:\n` +
        missing.map((v) => `  • ${v}`).join("\n") +
        `\n\nSet these in your .env file before starting the app.`
    );
  }

  // SHOPIFY_SCOPES is optional — defaults to all required scopes
  const rawScopes = process.env.SHOPIFY_SCOPES;
  const scopes = rawScopes
    ? rawScopes.split(",").map((s) => s.trim()).filter(Boolean)
    : [...REQUIRED_SCOPES];

  return {
    apiKey: apiKey!,
    apiSecret: apiSecret!,
    appUrl: appUrl!.replace(/\/$/, ""), // strip trailing slash
    scopes,
  };
}

/**
 * Validates that all required OAuth scopes are present.
 * Logs a warning for each missing scope but does not throw.
 */
export function validateScopes(grantedScopes: string[]): void {
  const grantedSet = new Set(grantedScopes);
  const missingScopes = REQUIRED_SCOPES.filter((s) => !grantedSet.has(s));

  if (missingScopes.length > 0) {
    console.warn(
      `[ghost/shopify] Warning: Missing required scopes:\n` +
        missingScopes.map((s) => `  • ${s}`).join("\n") +
        `\nSome features may not work correctly.`
    );
  }
}
