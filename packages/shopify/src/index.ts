// ─────────────────────────────────────────────
// @ghost/shopify — Public API
// ─────────────────────────────────────────────

export { getShopifyConfig, validateScopes } from "./config";
export type { ShopifyConfig } from "./config";

export {
  generateAuthUrl,
  validateCallback,
  verifyHmac,
  _clearPendingStates,
} from "./oauth";
export type { OAuthState, CallbackQuery } from "./oauth";

export { ShopifyAdminClient } from "./admin-client";
export type {
  ShopifyTheme,
  ThemeAsset,
  ThemeAssetWithContent,
  ScriptTag,
  ShopInfo,
} from "./admin-client";

export { ShopifyBilling, PLAN_CONFIG } from "./billing";
