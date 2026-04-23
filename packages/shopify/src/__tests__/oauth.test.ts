import { describe, it, expect, beforeEach } from "vitest";
import { generateAuthUrl, verifyHmac, _clearPendingStates } from "../oauth";
import { createHmac } from "crypto";

// ─────────────────────────────────────────────
// Test setup: stub required env vars
// ─────────────────────────────────────────────

const TEST_API_KEY = "test_api_key_abc123";
const TEST_API_SECRET = "test_api_secret_xyz789";
const TEST_APP_URL = "https://app.example.com";
const TEST_SHOP = "test-store.myshopify.com";

function setEnv() {
  process.env.SHOPIFY_API_KEY = TEST_API_KEY;
  process.env.SHOPIFY_API_SECRET = TEST_API_SECRET;
  process.env.SHOPIFY_APP_URL = TEST_APP_URL;
  process.env.SHOPIFY_SCOPES = "read_themes,write_themes,read_script_tags,write_script_tags";
}

// ─────────────────────────────────────────────
// Helper: build a valid HMAC for test params
// ─────────────────────────────────────────────

function buildHmac(params: Record<string, string>, secret: string): string {
  const { hmac: _hmac, ...rest } = params;
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("&");
  return createHmac("sha256", secret).update(message).digest("hex");
}

// ─────────────────────────────────────────────
// Tests: generateAuthUrl
// ─────────────────────────────────────────────

describe("generateAuthUrl", () => {
  beforeEach(() => {
    setEnv();
    _clearPendingStates();
  });

  it("returns a valid Shopify OAuth URL", () => {
    const { url, state } = generateAuthUrl(TEST_SHOP);

    expect(url).toMatch(new RegExp(`^https://${TEST_SHOP}/admin/oauth/authorize`));
    expect(state).toBeTruthy();
    expect(state.length).toBe(32); // 16 bytes → 32 hex chars
  });

  it("includes the correct client_id in the URL", () => {
    const { url } = generateAuthUrl(TEST_SHOP);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("client_id")).toBe(TEST_API_KEY);
  });

  it("includes the redirect_uri pointing to /auth/callback", () => {
    const { url } = generateAuthUrl(TEST_SHOP);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("redirect_uri")).toBe(`${TEST_APP_URL}/auth/callback`);
  });

  it("includes the scopes in the URL", () => {
    const { url } = generateAuthUrl(TEST_SHOP);
    const parsed = new URL(url);
    const scope = parsed.searchParams.get("scope") ?? "";
    expect(scope).toContain("read_themes");
    expect(scope).toContain("write_themes");
  });

  it("includes the state nonce in the URL", () => {
    const { url, state } = generateAuthUrl(TEST_SHOP);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("state")).toBe(state);
  });

  it("strips the protocol from the shop domain", () => {
    const { url } = generateAuthUrl(`https://${TEST_SHOP}`);
    expect(url).toMatch(new RegExp(`^https://${TEST_SHOP}/admin/oauth/authorize`));
  });

  it("generates unique state nonces for each call", () => {
    const { state: s1 } = generateAuthUrl(TEST_SHOP);
    const { state: s2 } = generateAuthUrl(TEST_SHOP);
    expect(s1).not.toBe(s2);
  });
});

// ─────────────────────────────────────────────
// Tests: verifyHmac
// ─────────────────────────────────────────────

describe("verifyHmac", () => {
  const secret = TEST_API_SECRET;

  it("returns true for a known-good HMAC signature", () => {
    const params: Record<string, string> = {
      code: "auth_code_123",
      shop: TEST_SHOP,
      state: "abc123def456",
      timestamp: "1609459200",
    };
    const hmac = buildHmac(params, secret);

    expect(verifyHmac({ ...params, hmac }, secret)).toBe(true);
  });

  it("returns false when the HMAC is tampered", () => {
    const params: Record<string, string> = {
      code: "auth_code_123",
      shop: TEST_SHOP,
      state: "abc123def456",
      timestamp: "1609459200",
    };
    const hmac = buildHmac(params, secret);
    const tampered = hmac.slice(0, -4) + "0000"; // corrupt last 4 chars

    expect(verifyHmac({ ...params, hmac: tampered }, secret)).toBe(false);
  });

  it("returns false when a query param is modified after signing", () => {
    const params: Record<string, string> = {
      code: "auth_code_123",
      shop: TEST_SHOP,
      state: "abc123def456",
      timestamp: "1609459200",
    };
    const hmac = buildHmac(params, secret);

    // Tamper with a param
    params.shop = "evil-store.myshopify.com";

    expect(verifyHmac({ ...params, hmac }, secret)).toBe(false);
  });

  it("returns false when hmac is missing from query", () => {
    const params: Record<string, string> = {
      code: "auth_code_123",
      shop: TEST_SHOP,
      state: "abc123def456",
    };

    expect(verifyHmac(params, secret)).toBe(false);
  });

  it("returns false when using the wrong secret", () => {
    const params: Record<string, string> = {
      code: "auth_code_123",
      shop: TEST_SHOP,
      state: "abc123def456",
      timestamp: "1609459200",
    };
    const hmac = buildHmac(params, secret);

    expect(verifyHmac({ ...params, hmac }, "wrong_secret")).toBe(false);
  });

  it("is resistant to parameter ordering attacks", () => {
    // HMAC should produce same result regardless of key order in params
    const paramsOrdered: Record<string, string> = {
      code: "auth_code_123",
      shop: TEST_SHOP,
      state: "nonce",
      timestamp: "1609459200",
    };
    const hmac = buildHmac(paramsOrdered, secret);

    // Verify with params in different order
    const paramsReversed: Record<string, string> = {
      timestamp: "1609459200",
      state: "nonce",
      shop: TEST_SHOP,
      code: "auth_code_123",
    };

    expect(verifyHmac({ ...paramsReversed, hmac }, secret)).toBe(true);
  });
});
