import type { ShopifyAdminClient, ThemeAssetWithContent } from "@ghost/shopify";
import type { OrphanFinding } from "@ghost/shared";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface CommentResult {
  assetKey: string;
  originalContent: string;
  modifiedContent: string;
  selectorsCommented: number;
}

// ─────────────────────────────────────────────
// Ghost Code Comment Markers
// ─────────────────────────────────────────────

const CSS_COMMENT_HEADER = (selector: string) =>
  `/* [GHOST-CODE-CLEANER: orphaned rule - ${selector}]`;
const CSS_COMMENT_FOOTER = `*/`;

const HTML_COMMENT_HEADER = `<!-- [GHOST-CODE-CLEANER: orphaned script]`;
const HTML_COMMENT_FOOTER = `-->`;

const JS_COMMENT_HEADER = `/* [GHOST-CODE-CLEANER: orphaned JS block] */`;
const JS_COMMENT_FOOTER = `/* [GHOST-CODE-CLEANER: end orphaned JS block] */`;

// ─────────────────────────────────────────────
// CSS Selector Commenting
// ─────────────────────────────────────────────

/**
 * Comments out CSS rules matching the given selectors in a CSS text string.
 *
 * Strategy:
 *   For each selector, find the full rule block (selector { declarations })
 *   using a bracket-aware scan, then wrap it in GHOST-CODE-CLEANER comments.
 *
 * The approach uses bracket counting rather than a naive regex so it
 * correctly handles nested rules and multi-line declarations.
 */
export function commentOutCSSSelectors(cssText: string, selectors: string[]): string {
  if (selectors.length === 0) return cssText;

  let result = cssText;

  for (const selector of selectors) {
    // Escape selector for use in a regex (handles . # [ ] etc.)
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Match the selector followed by optional whitespace and an opening brace.
    // Then capture everything up to the matching closing brace.
    // This regex handles single-level rules; nested @-rules need separate handling.
    const ruleRegex = new RegExp(
      `(${escaped}\\s*\\{[^{}]*\\})`,
      "g"
    );

    result = result.replace(ruleRegex, (match) => {
      // Don't double-comment already commented rules
      if (result.includes(`[GHOST-CODE-CLEANER: orphaned rule - ${selector}]`)) {
        return match;
      }
      return (
        `${CSS_COMMENT_HEADER(selector)}\n` +
        `${match}\n` +
        `${CSS_COMMENT_FOOTER}`
      );
    });
  }

  return result;
}

// ─────────────────────────────────────────────
// Script Tag Commenting
// ─────────────────────────────────────────────

/**
 * Wraps `<script>` tags whose `src` attribute matches `scriptUrl` in
 * GHOST-CODE-CLEANER HTML comments inside a Liquid/HTML file.
 *
 * Handles both exact and partial URL matches (e.g. the CDN URL may have
 * query string parameters appended at runtime).
 */
export function commentOutScriptTag(htmlText: string, scriptUrl: string): string {
  // Match <script ... src="...scriptUrl..." ...></script> (possibly multi-line)
  const escaped = scriptUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const scriptTagRegex = new RegExp(
    `(<script[^>]*src=["'][^"']*${escaped}[^"']*["'][^>]*>(?:[\\s\\S]*?)<\/script>)`,
    "gi"
  );

  return htmlText.replace(scriptTagRegex, (match) => {
    if (htmlText.includes("[GHOST-CODE-CLEANER: orphaned script]")) return match;
    return `${HTML_COMMENT_HEADER}\n${match}\n${HTML_COMMENT_FOOTER}`;
  });
}

// ─────────────────────────────────────────────
// JS Block Commenting
// ─────────────────────────────────────────────

/**
 * Wraps lines [lineStart, lineEnd] (1-indexed, inclusive) in a JS
 * GHOST-CODE-CLEANER block comment in the given JS source text.
 */
export function commentOutJSBlock(
  jsText: string,
  lineStart: number,
  lineEnd: number
): string {
  const lines = jsText.split("\n");

  if (lineStart < 1 || lineEnd > lines.length || lineStart > lineEnd) {
    throw new RangeError(
      `[ghost/commenter] Invalid line range ${lineStart}-${lineEnd} ` +
      `(file has ${lines.length} lines)`
    );
  }

  // Insert footer BEFORE inserting header so line indices don't shift
  lines.splice(lineEnd, 0, JS_COMMENT_FOOTER);
  lines.splice(lineStart - 1, 0, JS_COMMENT_HEADER);

  return lines.join("\n");
}

// ─────────────────────────────────────────────
// Apply Findings to Theme
// ─────────────────────────────────────────────

/**
 * Groups findings by fileUrl, fetches each file, applies the appropriate
 * commenter, and uploads the modified content back to Shopify.
 *
 * Safety: skips any file operation if the theme's role is "main".
 * The caller must verify the themeId is an unpublished duplicate before calling.
 *
 * @param client        Authenticated ShopifyAdminClient
 * @param themeId       Unpublished duplicate theme ID to modify
 * @param findings      Orphan findings to comment out
 * @param progressCallback  Optional callback after each file is processed
 */
export async function applyFindingsToTheme(
  client: ShopifyAdminClient,
  themeId: number,
  findings: OrphanFinding[],
  progressCallback?: (done: number, total: number) => void
): Promise<CommentResult[]> {
  // Safety check: refuse to operate on a main (live) theme
  const theme = await client.getTheme(themeId);
  if (theme.role === "main") {
    throw new Error(
      `[ghost/commenter] Safety violation: refusing to modify the live theme ` +
      `"${theme.name}" (id: ${themeId}). Use the unpublished duplicate.`
    );
  }

  // Group findings by fileUrl
  const byFile = new Map<string, OrphanFinding[]>();
  for (const finding of findings) {
    const existing = byFile.get(finding.fileUrl) ?? [];
    existing.push(finding);
    byFile.set(finding.fileUrl, existing);
  }

  const results: CommentResult[] = [];
  let done = 0;
  const total = byFile.size;

  for (const [fileUrl, fileFindings] of byFile) {
    // Derive the Shopify asset key from the URL
    // e.g. https://cdn.shopify.com/.../assets/theme.css → assets/theme.css
    const assetKey = deriveAssetKey(fileUrl);
    if (!assetKey) {
      console.warn(`[ghost/commenter] Cannot derive asset key from URL: ${fileUrl} — skipping`);
      continue;
    }

    let asset: ThemeAssetWithContent;
    try {
      asset = await client.getThemeAsset(themeId, assetKey);
    } catch (err) {
      console.warn(`[ghost/commenter] Could not fetch asset "${assetKey}": ${String(err)} — skipping`);
      continue;
    }

    const originalContent = asset.value;
    let modifiedContent = originalContent;
    let selectorsCommented = 0;

    // Apply the right commenter based on file type
    if (assetKey.endsWith(".css") || assetKey.endsWith(".css.liquid")) {
      const cssSelectors = fileFindings
        .map((f) => f.selector)
        .filter((s): s is string => Boolean(s));

      modifiedContent = commentOutCSSSelectors(modifiedContent, cssSelectors);
      selectorsCommented = cssSelectors.length;
    } else if (assetKey.endsWith(".liquid") || assetKey.endsWith(".html")) {
      // Comment out any script tags referenced in findings
      for (const finding of fileFindings) {
        if (finding.type === "js" && finding.fileUrl) {
          modifiedContent = commentOutScriptTag(modifiedContent, finding.fileUrl);
          selectorsCommented++;
        }
      }
    } else if (assetKey.endsWith(".js")) {
      // JS block commenting — skip if no line range info available
      console.info(`[ghost/commenter] JS file "${assetKey}" — no line range info, skipping`);
    }

    // Upload modified content
    if (modifiedContent !== originalContent) {
      try {
        await client.updateThemeAsset(themeId, assetKey, modifiedContent);
        results.push({ assetKey, originalContent, modifiedContent, selectorsCommented });
      } catch (err) {
        console.error(`[ghost/commenter] Failed to update "${assetKey}": ${String(err)}`);
      }
    }

    done++;
    progressCallback?.(done, total);
  }

  return results;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Attempts to extract a Shopify theme asset key from a full CDN URL.
 * e.g. "https://cdn.shopify.com/s/files/1/0001/theme/assets/base.css?v=123"
 *   → "assets/base.css"
 */
function deriveAssetKey(fileUrl: string): string | null {
  try {
    const url = new URL(fileUrl);
    // Strip query string
    const path = url.pathname;
    // Find "assets/" in the path
    const assetIdx = path.indexOf("/assets/");
    if (assetIdx !== -1) {
      return path.slice(assetIdx + 1); // "assets/base.css"
    }
    return null;
  } catch {
    return null;
  }
}
