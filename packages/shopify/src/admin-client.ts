import Bottleneck from "bottleneck";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface ShopifyTheme {
  id: number;
  name: string;
  role: "main" | "unpublished" | "demo";
  createdAt: string;
  updatedAt: string;
}

export interface ThemeAsset {
  key: string;
  contentType: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  publicUrl: string | null;
}

export interface ThemeAssetWithContent extends ThemeAsset {
  value: string;
}

export interface ScriptTag {
  id: number;
  src: string;
  event: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShopInfo {
  name: string;
  domain: string;
  email: string;
  plan: string;
}

// ─────────────────────────────────────────────
// Admin Client
// ─────────────────────────────────────────────

const API_VERSION = "2025-01";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

/**
 * Shopify Admin REST API client with built-in:
 *   - Rate limiting: 2 requests/second (Shopify standard REST limit)
 *   - 429 handling: respects Retry-After header
 *   - 5xx retry: up to 3 attempts with exponential backoff
 */
export class ShopifyAdminClient {
  private readonly shop: string;
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly limiter: Bottleneck;

  constructor(shop: string, accessToken: string) {
    this.shop = shop;
    this.accessToken = accessToken;
    this.baseUrl = `https://${shop}/admin/api/${API_VERSION}`;

    // Shopify REST API: 2 requests/second per store (leaky bucket)
    this.limiter = new Bottleneck({
      minTime: 500,        // minimum 500ms between requests = 2 req/sec
      maxConcurrent: 1,    // serialise all requests
      highWater: 50,       // queue max 50 pending requests
      strategy: Bottleneck.strategy.OVERFLOW_PRIORITY,
    });
  }

  // ─────────────────────────────────────────────
  // Shop
  // ─────────────────────────────────────────────

  async getShop(): Promise<ShopInfo> {
    const data = await this.request<{ shop: { name: string; domain: string; email: string; plan_name: string } }>(
      "GET",
      "/shop.json"
    );
    return {
      name: data.shop.name,
      domain: data.shop.domain,
      email: data.shop.email,
      plan: data.shop.plan_name,
    };
  }

  // ─────────────────────────────────────────────
  // Themes
  // ─────────────────────────────────────────────

  async listThemes(): Promise<ShopifyTheme[]> {
    const data = await this.request<{ themes: RawTheme[] }>("GET", "/themes.json");
    return data.themes.map(mapTheme);
  }

  async getTheme(themeId: number): Promise<ShopifyTheme> {
    const data = await this.request<{ theme: RawTheme }>("GET", `/themes/${themeId}.json`);
    return mapTheme(data.theme);
  }

  async createTheme(name: string): Promise<ShopifyTheme> {
    const data = await this.request<{ theme: RawTheme }>("POST", "/themes.json", {
      theme: { name, role: "unpublished" },
    });
    return mapTheme(data.theme);
  }

  async deleteTheme(themeId: number): Promise<void> {
    await this.request("DELETE", `/themes/${themeId}.json`);
  }

  // ─────────────────────────────────────────────
  // Theme Assets
  // ─────────────────────────────────────────────

  async listThemeAssets(themeId: number): Promise<ThemeAsset[]> {
    const data = await this.request<{ assets: RawAsset[] }>(
      "GET",
      `/themes/${themeId}/assets.json`
    );
    return data.assets.map(mapAsset);
  }

  async getThemeAsset(themeId: number, key: string): Promise<ThemeAssetWithContent> {
    const params = new URLSearchParams({ "asset[key]": key });
    const data = await this.request<{ asset: RawAssetWithContent }>(
      "GET",
      `/themes/${themeId}/assets.json?${params.toString()}`
    );
    return mapAssetWithContent(data.asset);
  }

  async updateThemeAsset(themeId: number, key: string, value: string): Promise<ThemeAsset> {
    const data = await this.request<{ asset: RawAsset }>(
      "PUT",
      `/themes/${themeId}/assets.json`,
      { asset: { key, value } }
    );
    return mapAsset(data.asset);
  }

  // ─────────────────────────────────────────────
  // Script Tags
  // ─────────────────────────────────────────────

  async getScriptTags(): Promise<ScriptTag[]> {
    const data = await this.request<{ script_tags: RawScriptTag[] }>(
      "GET",
      "/script_tags.json"
    );
    return data.script_tags.map(mapScriptTag);
  }

  async deleteScriptTag(id: number): Promise<void> {
    await this.request("DELETE", `/script_tags/${id}.json`);
  }

  // ─────────────────────────────────────────────
  // Private: HTTP request with rate limit + retry
  // ─────────────────────────────────────────────

  private async request<T = unknown>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown
  ): Promise<T> {
    return this.limiter.schedule(() => this.requestWithRetry<T>(method, path, body));
  }

  private async requestWithRetry<T>(
    method: string,
    path: string,
    body: unknown,
    attempt = 1
  ): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      "X-Shopify-Access-Token": this.accessToken,
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };

    let response: Response;
    try {
      response = await fetch(url, fetchOptions);
    } catch (err) {
      // Network error — retry with backoff
      if (attempt <= MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
        return this.requestWithRetry<T>(method, path, body, attempt + 1);
      }
      throw new Error(`[ghost/shopify] Network error after ${MAX_RETRIES} attempts: ${String(err)}`);
    }

    // ── 429 Rate Limited ────────────────────────────────────────────────────
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get("Retry-After");
      const waitMs = retryAfterHeader
        ? parseFloat(retryAfterHeader) * 1000
        : 2000; // default 2s

      console.warn(`[ghost/shopify] Rate limited — waiting ${waitMs}ms before retry`);
      await sleep(waitMs);

      if (attempt <= MAX_RETRIES) {
        return this.requestWithRetry<T>(method, path, body, attempt + 1);
      }
      throw new Error(`[ghost/shopify] Rate limit exceeded after ${MAX_RETRIES} retries`);
    }

    // ── 5xx Server Error ────────────────────────────────────────────────────
    if (response.status >= 500) {
      if (attempt <= MAX_RETRIES) {
        const backoff = BASE_DELAY_MS * 2 ** (attempt - 1); // 500ms, 1s, 2s
        console.warn(
          `[ghost/shopify] Server error ${response.status} — retry ${attempt}/${MAX_RETRIES} in ${backoff}ms`
        );
        await sleep(backoff);
        return this.requestWithRetry<T>(method, path, body, attempt + 1);
      }
      throw new Error(
        `[ghost/shopify] Server error ${response.status} after ${MAX_RETRIES} retries on ${method} ${path}`
      );
    }

    // ── 204 No Content ──────────────────────────────────────────────────────
    if (response.status === 204 || method === "DELETE") {
      return undefined as T;
    }

    // ── Error responses ─────────────────────────────────────────────────────
    if (!response.ok) {
      const text = await response.text().catch(() => "(no body)");
      throw new Error(
        `[ghost/shopify] ${method} ${path} failed (${response.status}): ${text}`
      );
    }

    return (await response.json()) as T;
  }
}

// ─────────────────────────────────────────────
// Internal raw types (Shopify API snake_case)
// ─────────────────────────────────────────────

interface RawTheme {
  id: number;
  name: string;
  role: "main" | "unpublished" | "demo";
  created_at: string;
  updated_at: string;
}

interface RawAsset {
  key: string;
  content_type: string;
  size: number;
  created_at: string;
  updated_at: string;
  public_url: string | null;
}

interface RawAssetWithContent extends RawAsset {
  value: string;
}

interface RawScriptTag {
  id: number;
  src: string;
  event: string;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────
// Mappers (snake_case → camelCase)
// ─────────────────────────────────────────────

function mapTheme(r: RawTheme): ShopifyTheme {
  return {
    id: r.id,
    name: r.name,
    role: r.role,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapAsset(r: RawAsset): ThemeAsset {
  return {
    key: r.key,
    contentType: r.content_type,
    size: r.size,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    publicUrl: r.public_url,
  };
}

function mapAssetWithContent(r: RawAssetWithContent): ThemeAssetWithContent {
  return {
    ...mapAsset(r),
    value: r.value ?? "",
  };
}

function mapScriptTag(r: RawScriptTag): ScriptTag {
  return {
    id: r.id,
    src: r.src,
    event: r.event,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ─────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
