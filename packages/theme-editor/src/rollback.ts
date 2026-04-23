import type { ShopifyAdminClient } from "@ghost/shopify";

// ─────────────────────────────────────────────
// Rollback
// ─────────────────────────────────────────────

/**
 * Rolls back a Ghost Code Cleaner purge by DELETING the duplicate theme.
 *
 * Safety contract:
 *   1. Fetches the theme to verify it is NOT role:"main"
 *   2. If main → throws Error immediately (never deletes the live theme)
 *   3. If unpublished → deletes the theme
 *
 * The original/source theme is NEVER touched. Only the Ghost-Code duplicate
 * (created by duplicateTheme) is eligible for deletion via this function.
 *
 * @param client           Authenticated ShopifyAdminClient
 * @param duplicateThemeId  ID of the duplicate theme created by Ghost Code Cleaner
 */
export async function rollbackPurge(
  client: ShopifyAdminClient,
  duplicateThemeId: number
): Promise<void> {
  // ── Safety check ─────────────────────────────────────────────────────────
  let themeName = `(theme ${duplicateThemeId})`;

  const theme = await client.getTheme(duplicateThemeId);
  themeName = `"${theme.name}"`;

  if (theme.role === "main") {
    throw new Error(
      `[ghost/rollback] Refusing to delete the live theme ${themeName} ` +
      `(id: ${duplicateThemeId}, role: main). ` +
      `Only Ghost Code Cleaner duplicate themes (role: unpublished) can be rolled back.`
    );
  }

  // ── Delete the duplicate ──────────────────────────────────────────────────
  await client.deleteTheme(duplicateThemeId);

  console.log(
    `[ghost/rollback] Rollback complete — duplicate theme ${themeName} ` +
    `(id: ${duplicateThemeId}) deleted.`
  );
}
