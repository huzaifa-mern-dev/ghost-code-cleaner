// ─────────────────────────────────────────────
// Shopify Template Types
// ─────────────────────────────────────────────

export const SHOPIFY_TEMPLATES = [
  "index",
  "product",
  "collection",
  "cart",
  "page",
  "blog",
  "article",
  "search",
  "404",
] as const;

export type ShopifyTemplate = (typeof SHOPIFY_TEMPLATES)[number];

// ─────────────────────────────────────────────
// Asset Source Classification
// Used to determine confidence ceiling:
//   theme       → MAX medium (Tailwind/utility classes may be real)
//   shopify_app → CAN be HIGH if 0% coverage + not in DOM
//   unknown     → MAX medium (conservative)
// ─────────────────────────────────────────────

export type AssetSource = "theme" | "shopify_app" | "unknown";

// ─────────────────────────────────────────────
// Known App CDN Patterns
// Each entry maps a URL hostname/path pattern to an app name.
// The source field must always be "shopify_app".
// ─────────────────────────────────────────────

export const APP_CDN_PATTERNS: Array<{
  /** Regex tested against the full asset URL */
  pattern: RegExp;
  appName: string;
}> = [
  { pattern: /klaviyo\.com/i,                              appName: "Klaviyo" },
  { pattern: /apps\.shopifycdn\.com\/judgeme/i,            appName: "Judge.me" },
  { pattern: /loox\.io/i,                                  appName: "Loox" },
  { pattern: /yotpo\.com/i,                                appName: "Yotpo" },
  { pattern: /stamped\.io/i,                               appName: "Stamped.io" },
  { pattern: /rechargeapps\.com/i,                         appName: "ReCharge" },
  { pattern: /apps\.shopifycdn\.com\/bold/i,               appName: "Bold Commerce" },
  { pattern: /privy\.com/i,                                appName: "Privy" },
  { pattern: /gorgias\.com/i,                              appName: "Gorgias" },
  { pattern: /tidio\.com/i,                                appName: "Tidio" },
  { pattern: /omnisend\.com/i,                             appName: "Omnisend" },
  { pattern: /smsbump\.com/i,                              appName: "SMSBump" },
  { pattern: /attentivemobile\.com/i,                      appName: "Attentive" },
  { pattern: /loyaltylion\.com/i,                          appName: "LoyaltyLion" },
  { pattern: /apps\.shopifycdn\.com\/smile-io/i,           appName: "Smile.io" },
  { pattern: /growave\.io/i,                               appName: "Growave" },
  { pattern: /okendo\.io/i,                                appName: "Okendo" },
  { pattern: /rebuyengine\.com/i,                          appName: "Rebuy" },
  { pattern: /postscript\.io/i,                            appName: "Postscript" },
  { pattern: /apps\.shopifycdn\.com\/wishlist-plus/i,      appName: "Wishlist Plus" },
];

// ─────────────────────────────────────────────
// Shopify Platform Domains
// Assets from these domains are NEVER orphans
// ─────────────────────────────────────────────

export const SHOPIFY_PLATFORM_DOMAINS: string[] = [
  "cdn.shopify.com",
  "monorail-edge.shopifysvc.com",
  "shopify-assets.shopifycdn.com",
];

// ─────────────────────────────────────────────
// Theme URL Patterns
// If the asset URL matches one of these patterns
// it is classified as source = "theme".
// ─────────────────────────────────────────────

/**
 * Patterns that identify a URL as the store's own theme CSS.
 * Shopify theme assets are served from the store's own domain under
 * /cdn/shop/t/<themeId>/assets/ or similar paths.
 */
export const THEME_URL_PATTERNS: readonly RegExp[] = [
  /\/cdn\/shop\/t\/\d+\/assets\//i,   // Standard Shopify theme CDN path
  /\/assets\/theme[\._-]/i,           // theme.css, theme_v2.css, etc.
  /\/assets\/base[\._-]/i,            // base.css (Dawn theme)
  /\/assets\/component-/i,            // component-*.css (Dawn/other themes)
  /\/assets\/section-/i,              // section-*.css
  /\/assets\/template-/i,             // template-*.css
  /\/assets\/layout-/i,               // layout-*.css
  /\/assets\/global[\._-]/i,          // global.css
  /\/assets\/application[\._-]/i,     // application.css
  /\/assets\/storefront[\._-]/i,      // storefront.css
  /\/assets\/style/i,                 // styles.css, style.css
  /\/assets\/main[\._-]/i,            // main.css
  /\/assets\/custom[\._-]/i,          // custom.css
];

// ─────────────────────────────────────────────
// CSS Safelist
// Selectors matching these patterns are NEVER
// classified as HIGH confidence orphans.
// ─────────────────────────────────────────────

/** Exact selector strings that are always safelisted */
export const CSS_SAFELIST_EXACT: ReadonlySet<string> = new Set([
  ":root",
  "*",
  "html",
  "body",
  ":before",
  ":after",
  "::before",
  "::after",
  "::placeholder",
  ":placeholder",
  ".sr-only",
  ".visually-hidden",
  ".hidden",
  ".active",
  ".is-active",
  ".open",
  ".is-open",
]);

/** Substring patterns — if selector contains any of these, it is safelisted */
export const CSS_SAFELIST_CONTAINS: readonly string[] = [
  "@keyframes",
  "@media",
  "@font-face",
  ":root",
  "::before",
  "::after",
  "::placeholder",
];

/** Minimum character length — selectors shorter than this are safelisted */
export const CSS_SAFELIST_MIN_LENGTH = 3;

// ─────────────────────────────────────────────
// Queue Names
// ─────────────────────────────────────────────

export const QUEUE_NAMES = {
  AUDIT: "audit",
  PURGE: "purge",
  NOTIFICATION: "notification",
} as const;

// ─────────────────────────────────────────────
// CDP Coverage Thresholds
// ─────────────────────────────────────────────

export const COVERAGE_THRESHOLDS = {
  /**
   * A selector must have coveragePercent === 0 across ALL templates to be HIGH.
   * Theme files are capped at MEDIUM regardless.
   */
  HIGH_CONFIDENCE: 0, // exactly 0% across all crawled templates
  /**
   * MEDIUM: selector was used in some templates but < MEDIUM_CONFIDENCE %
   * averaged across all crawled templates.
   */
  MEDIUM_CONFIDENCE: 5, // avg coverage < 5% → medium
} as const;
