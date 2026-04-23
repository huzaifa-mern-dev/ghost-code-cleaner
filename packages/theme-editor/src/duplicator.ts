import type { ShopifyAdminClient, ShopifyTheme, ThemeAsset } from "@ghost/shopify";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface DuplicationProgress {
  total: number;
  copied: number;
  percent: number;
}

// Text-based file extensions that can be duplicated via the Admin API.
// Binary formats (images, fonts) are served directly by Shopify CDN
// and don't need to be copied asset-by-asset.
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".liquid",
  ".json",
  ".svg",
  ".txt",
  ".md",
]);

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico",
  ".woff", ".woff2", ".ttf", ".eot",
]);

/** Returns true if the asset key is a text-based file we should copy */
function isTextAsset(key: string): boolean {
  const lower = key.toLowerCase();
  const ext = "." + lower.split(".").pop();

  // Explicit binary exclusion first
  if (BINARY_EXTENSIONS.has(ext)) return false;

  // Only include known text types
  return TEXT_EXTENSIONS.has(ext);
}

// ─────────────────────────────────────────────
// Theme Duplication
// ─────────────────────────────────────────────

/**
 * Duplicates a Shopify theme by:
 *   1. Fetching the source theme name
 *   2. Creating a new UNPUBLISHED theme named "Ghost-Code Clean [YYYY-MM-DD]"
 *   3. Listing all assets on the source theme
 *   4. Filtering to text-based assets only
 *   5. Copying each asset in batches of 5 (rate-limit friendly)
 *   6. Reporting progress via optional callback
 *
 * Safety: the source theme is only ever READ. The function may be called on a
 * "main" theme (to copy it) but will NEVER write to a theme with role "main".
 *
 * @param client       Authenticated ShopifyAdminClient
 * @param sourceThemeId  Theme to duplicate (read-only access)
 * @param progressCallback  Optional callback fired after each batch
 */
export async function duplicateTheme(
  client: ShopifyAdminClient,
  sourceThemeId: number,
  progressCallback?: (progress: DuplicationProgress) => void
): Promise<ShopifyTheme> {
  // ── Step 1: Fetch source theme name ─────────────────────────────────────
  const sourceTheme = await client.getTheme(sourceThemeId);

  // ── Step 2: Create new unpublished theme ─────────────────────────────────
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const newThemeName = `Ghost-Code Clean [${today}]`;

  const newTheme = await client.createTheme(newThemeName);
  console.log(`[ghost/duplicator] Created theme "${newThemeName}" (id: ${newTheme.id})`);

  // ── Step 3: List all source assets ──────────────────────────────────────
  const allAssets = await client.listThemeAssets(sourceThemeId);

  // ── Step 4: Filter to text-based assets ─────────────────────────────────
  const textAssets = allAssets.filter((a: ThemeAsset) => isTextAsset(a.key));

  console.log(
    `[ghost/duplicator] Copying ${textAssets.length}/${allAssets.length} assets ` +
    `from "${sourceTheme.name}" → "${newThemeName}"`
  );

  // ── Step 5: Copy in batches of 5 ────────────────────────────────────────
  const BATCH_SIZE = 5;
  let copied = 0;

  for (let i = 0; i < textAssets.length; i += BATCH_SIZE) {
    const batch = textAssets.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (asset: ThemeAsset) => {
        try {
          const { value } = await client.getThemeAsset(sourceThemeId, asset.key);
          await client.updateThemeAsset(newTheme.id, asset.key, value);
        } catch (err) {
          // Log but don't abort — some assets (e.g. remote CDN files) may 404
          console.warn(`[ghost/duplicator] Skipped asset "${asset.key}": ${String(err)}`);
        }
      })
    );

    copied += batch.length;

    // ── Step 6: Progress callback ───────────────────────────────────────────
    if (progressCallback) {
      progressCallback({
        total: textAssets.length,
        copied,
        percent: Math.round((copied / textAssets.length) * 100),
      });
    }
  }

  console.log(`[ghost/duplicator] Duplication complete — theme id: ${newTheme.id}`);
  return newTheme;
}

// ─────────────────────────────────────────────
// Safety Guards
// ─────────────────────────────────────────────

/**
 * Throws if the given theme is the live published ("main") theme.
 * Call this before any WRITE operation on a theme ID to prevent
 * accidentally modifying the live storefront.
 */
export function assertNotMainTheme(theme: ShopifyTheme): void {
  if (theme.role === "main") {
    throw new Error(
      `[ghost/duplicator] Safety violation: refusing to write to the live theme ` +
      `"${theme.name}" (id: ${theme.id}, role: main). ` +
      `Always operate on a duplicate with role: unpublished.`
    );
  }
}
