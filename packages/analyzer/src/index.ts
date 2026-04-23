import type { AssetAttribution, SelectorCoverage } from "@ghost/shared";
import {
  SHOPIFY_PLATFORM_DOMAINS,
  APP_CDN_PATTERNS,
  THEME_URL_PATTERNS,
} from "@ghost/shared";

/**
 * Parses a CSS file string using css-tree and extracts all selectors
 * along with their source file attribution.
 */
export async function parseCSS(
  cssContent: string,
  fileUrl: string
): Promise<SelectorCoverage[]> {
  const csstree = await import("css-tree");

  const ast = csstree.parse(cssContent, {
    parseAtrulePrelude: false,
    parseRulePrelude: false,
    parseValue: false,
  });

  const selectors: SelectorCoverage[] = [];

  csstree.walk(ast, (node) => {
    if (node.type === "Rule" && node.prelude.type === "SelectorList") {
      const selector = csstree.generate(node.prelude);
      const rawBytes = Buffer.byteLength(csstree.generate(node), "utf8");
      selectors.push({
        selector,
        usedBytes: 0,
        totalBytes: rawBytes,
        coveragePercent: 0,
        fileUrl,
      });
    }
  });

  return selectors;
}

/**
 * Analyses a JavaScript file using acorn AST parsing to identify
 * potential orphan script blocks (e.g. app-specific globals).
 */
export async function analyzeJS(
  jsContent: string,
  fileUrl: string
): Promise<{ fileUrl: string; identifiers: string[] }> {
  const acorn = await import("acorn");
  const walk = await import("acorn-walk");

  const ast = acorn.parse(jsContent, {
    ecmaVersion: "latest",
    sourceType: "module",
  });

  const identifiers: string[] = [];

  interface IdentifierNode {
    name: string;
  }

  walk.simple(ast, {
    Identifier(node) {
      identifiers.push((node as unknown as IdentifierNode).name);
    },
  });

  return { fileUrl, identifiers };
}

/**
 * Attributes a CSS/JS asset with full source classification:
 *
 *   isShopifyPlatform → true if served from Shopify infrastructure (skip entirely)
 *   isKnownAppCdn     → true if matched against a known third-party app CDN pattern
 *   source            → "shopify_app" | "theme" | "unknown"
 *
 * Source determination rules (in priority order):
 *   1. Shopify platform domain             → isShopifyPlatform = true, source = "unknown"
 *   2. Matches an APP_CDN_PATTERN          → source = "shopify_app", isKnownAppCdn = true
 *   3. URL matches THEME_URL_PATTERNS      → source = "theme"
 *   4. URL is on the store's own hostname  → source = "theme" (store-hosted asset)
 *   5. Everything else                     → source = "unknown"
 */
export function attributeAsset(fileUrl: string, storeHostname?: string): AssetAttribution {
  // ── 1. Shopify platform domain check ────────────────────────────────────
  let isShopifyPlatform = false;
  let urlHostname = "";
  try {
    urlHostname = new URL(fileUrl).hostname;
    isShopifyPlatform = SHOPIFY_PLATFORM_DOMAINS.some(
      (d) => urlHostname === d || urlHostname.endsWith(`.${d}`)
    );
  } catch {
    // Relative or malformed URL — not a platform domain
  }

  if (isShopifyPlatform) {
    const isCss = fileUrl.split("?")[0].endsWith(".css");
    return {
      fileUrl,
      type: isCss ? "css" : "js",
      source: "unknown",
      isKnownAppCdn: false,
      isShopifyPlatform: true,
    };
  }

  // ── 2. Determine asset type by extension (strip query string first) ──────
  const isCss = fileUrl.split("?")[0].endsWith(".css");
  const type: AssetAttribution["type"] = isCss ? "css" : "js";

  // ── 3. Check against known app CDN patterns ──────────────────────────────
  for (const { pattern, appName } of APP_CDN_PATTERNS) {
    if (pattern.test(fileUrl)) {
      return {
        fileUrl,
        type,
        source: "shopify_app",
        sourceApp: appName,
        cdnPattern: pattern.source,
        isKnownAppCdn: true,
        isShopifyPlatform: false,
      };
    }
  }

  // ── 4. Check if this is a theme asset ────────────────────────────────────
  // A URL is "theme" if:
  //   a) it matches a known Shopify theme asset path pattern, OR
  //   b) it is hosted on the same domain as the store (store-owned asset)
  const isThemeByPath = THEME_URL_PATTERNS.some((rx) => rx.test(fileUrl));
  const isThemeByHost =
    storeHostname !== undefined &&
    storeHostname !== "" &&
    urlHostname !== "" &&
    (urlHostname === storeHostname ||
      urlHostname.endsWith(`.${storeHostname}`) ||
      // Shopify stores CDN their theme under <store>.myshopify.com or
      // via the store's custom domain sub-paths
      storeHostname.endsWith(`.myshopify.com`) && urlHostname.includes("shopifycdn.com") ||
      // When store is e.g. gymshark.com and CDN is cdn.gymshark.com
      urlHostname.endsWith(`.${storeHostname.replace(/^www\./, "")}`)
    );

  if (isThemeByPath || isThemeByHost) {
    return {
      fileUrl,
      type,
      source: "theme",
      isKnownAppCdn: false,
      isShopifyPlatform: false,
    };
  }

  // ── 5. Unknown source — treat conservatively ────────────────────────────
  return {
    fileUrl,
    type,
    source: "unknown",
    isKnownAppCdn: false,
    isShopifyPlatform: false,
  };
}
