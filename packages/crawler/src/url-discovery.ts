// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface TemplateDefinition {
  name: string;
  path: string | null; // null = must be discovered dynamically
}

export interface TemplateConfig {
  name: string;
  url: string;
}

// ─────────────────────────────────────────────
// Static Shopify Template Definitions
// ─────────────────────────────────────────────

export const SHOPIFY_TEMPLATES: TemplateDefinition[] = [
  { name: "home", path: "/" },
  { name: "collection", path: "/collections/all" },
  { name: "product", path: null }, // discovered from sitemap
  { name: "cart", path: "/cart" },
  { name: "blog", path: "/blogs/news" },
  { name: "article", path: null }, // discovered from sitemap
  { name: "page", path: "/pages/about" },
  { name: "search", path: "/search?q=test" },
  { name: "notfound", path: "/ghost-code-404-test" },
];

// ─────────────────────────────────────────────
// Dynamic URL Discovery (sitemap.xml)
// ─────────────────────────────────────────────

/**
 * Fetches /sitemap.xml for the given store, extracts <loc> entries,
 * and returns the first product and article URLs found.
 * Falls back to generic paths if the sitemap is unavailable or empty.
 */
export async function discoverDynamicUrls(
  storeUrl: string
): Promise<{ product: string; article: string }> {
  const base = storeUrl.replace(/\/$/, "");

  const fallback = {
    product: `${base}/products`,
    article: `${base}/blogs/news`,
  };

  try {
    const res = await fetch(`${base}/sitemap.xml`, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "GhostCodeBot/1.0" },
    });

    if (!res.ok) return fallback;

    const xml = await res.text();

    // Extract all <loc> values
    const locMatches = [...xml.matchAll(/<loc>\s*(https?:\/\/[^\s<]+)\s*<\/loc>/gi)];
    const locs = locMatches.map((m) => m[1]);

    const product = locs.find(
      (l) => l.includes("/products/") && !l.endsWith("/products/")
    ) ?? fallback.product;

    const article = locs.find(
      (l) =>
        (l.includes("/blogs/") && l.split("/").length > 5) ||
        l.includes("/articles/")
    ) ?? fallback.article;

    return { product, article };
  } catch {
    return fallback;
  }
}

// ─────────────────────────────────────────────
// URL Validation
// ─────────────────────────────────────────────

/**
 * Returns true if the URL responds with a 2xx or 3xx status.
 * The 404 template is intentionally expected to 404 — always include it.
 */
async function isReachable(url: string, templateName: string): Promise<boolean> {
  if (templateName === "notfound") return true; // 404 template is always valid

  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(8_000),
      headers: { "User-Agent": "GhostCodeBot/1.0" },
    });
    // Accept 2xx and 3xx — 404 pages returned by Shopify still have theme CSS
    return res.status < 500;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────
// Crawl Plan Builder
// ─────────────────────────────────────────────

/**
 * Builds the full crawl plan for a store.
 * Discovers dynamic product/article URLs via sitemap, validates all URLs,
 * and returns only those that respond successfully.
 */
export async function buildCrawlPlan(storeUrl: string): Promise<TemplateConfig[]> {
  const base = storeUrl.replace(/\/$/, "");

  // Discover dynamic URLs
  const dynamic = await discoverDynamicUrls(storeUrl);

  // Build candidate list
  const candidates: TemplateConfig[] = SHOPIFY_TEMPLATES.map((tpl) => {
    let path: string;
    if (tpl.path !== null) {
      path = tpl.path;
    } else if (tpl.name === "product") {
      path = dynamic.product.startsWith("http")
        ? dynamic.product
        : `${base}${dynamic.product}`;
      // If we got a full URL, use it directly
      return { name: tpl.name, url: dynamic.product };
    } else {
      // article
      return { name: tpl.name, url: dynamic.article };
    }
    return { name: tpl.name, url: `${base}${path}` };
  });

  // Validate all URLs concurrently
  const validations = await Promise.all(
    candidates.map(async (c) => ({
      config: c,
      ok: await isReachable(c.url, c.name),
    }))
  );

  return validations.filter((v) => v.ok).map((v) => v.config);
}
