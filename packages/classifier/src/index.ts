import type {
  OrphanFinding,
  OrphanConfidence,
  RemovalRisk,
  SelectorCoverage,
  AssetAttribution,
} from "@ghost/shared";
import {
  CSS_SAFELIST_EXACT,
  CSS_SAFELIST_CONTAINS,
  CSS_SAFELIST_MIN_LENGTH,
} from "@ghost/shared";

export interface ClassifyInput {
  coverage: SelectorCoverage;
  attribution: AssetAttribution;
  auditId: string;
  /**
   * Total number of templates crawled in this audit.
   * Used to confirm that coveragePercent === 0 means unused across EVERY template.
   */
  totalTemplatesChecked: number;
  /**
   * Whether the selector's class/id tokens were found in at least one DOM snapshot
   * across all crawled templates. A DOM hit means the selector is likely still
   * referenced even if CDP coverage missed it (e.g. hidden states, JS-toggled classes).
   */
  foundInDomSnapshots: boolean;
  /**
   * For JS assets only: true if the script returned HTTP 404.
   * Only 404 assets are eligible for HIGH confidence on JS.
   */
  is404?: boolean;
}

// ─────────────────────────────────────────────
// Safelist Check
// ─────────────────────────────────────────────

/**
 * Returns true if the selector matches any safelist rule:
 *   - Exact match in CSS_SAFELIST_EXACT (e.g. :root, *, html, .hidden)
 *   - Contains a safelisted substring (e.g. @keyframes, ::before)
 *   - Is shorter than CSS_SAFELIST_MIN_LENGTH characters
 */
export function isSafelisted(selector: string): boolean {
  const trimmed = selector.trim();

  // Length gate: e.g. "a", "p", "h1"–"h6" etc.
  if (trimmed.length < CSS_SAFELIST_MIN_LENGTH) return true;

  // Exact match
  if (CSS_SAFELIST_EXACT.has(trimmed)) return true;

  // Substring match (case-insensitive for at-rules)
  const lower = trimmed.toLowerCase();
  if (CSS_SAFELIST_CONTAINS.some((s) => lower.includes(s.toLowerCase()))) {
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────
// Confidence Classification (v3)
// ─────────────────────────────────────────────

/**
 * Classifies a single CSS/JS asset as an orphan and assigns a confidence score.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ HIGH (auto-purge safe)                                                  │
 * │  • Any asset returning HTTP 404                                         │
 * │  • External app CSS (source = shopify_app)                              │
 * │    + coveragePercent === 0 across ALL templates                         │
 * │    + NOT found in any DOM snapshot                                      │
 * │    + NOT safelisted                                                     │
 * │    + NOT a Shopify platform domain                                      │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ MEDIUM (human review recommended)                                       │
 * │  • Theme/unknown CSS (source = theme | unknown)                         │
 * │    + coveragePercent === 0 + NOT in DOM + NOT safelisted                │
 * │    Reason: Tailwind/utility classes may be used on states not visited   │
 * │  • External app CSS with 0% coverage but FOUND in DOM snapshots         │
 * │  • Any CSS with 0 < coverage < 5%                                       │
 * │  • Known app CDN JS (not 404, but suspicious)                           │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ LOW (informational only)                                                │
 * │  • Safelisted selectors                                                 │
 * │  • CSS coverage ≥ 5%                                                    │
 * │  • Found in DOM snapshots (for theme files)                             │
 * │  • Any other JS not matching above rules                                │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ SKIP (never included)                                                   │
 * │  • Shopify platform domains (cdn.shopify.com etc.)                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
export function classifyOrphan(input: ClassifyInput): OrphanFinding {
  const {
    coverage,
    attribution,
    auditId,
    totalTemplatesChecked,
    foundInDomSnapshots,
    is404,
  } = input;

  let confidence: OrphanConfidence;
  let removalRisk: RemovalRisk;

  // ── Rule 0: 404 assets — always HIGH regardless of source ─────────────────
  if (is404) {
    return buildFinding(coverage, attribution, auditId, "high", "safe", is404);
  }

  // ── JS assets ─────────────────────────────────────────────────────────────
  if (attribution.type === "js") {
    if (attribution.isKnownAppCdn && attribution.source === "shopify_app" && !foundInDomSnapshots) {
      // Known app CDN, not in DOM → MEDIUM (suspicious but not provably dead)
      confidence = "medium";
      removalRisk = "moderate";
    } else {
      // All other JS → LOW (never flag active store JS as orphan)
      confidence = "low";
      removalRisk = "risky";
    }
    return buildFinding(coverage, attribution, auditId, confidence, removalRisk, is404);
  }

  // ── CSS assets ────────────────────────────────────────────────────────────

  const safelisted = isSafelisted(coverage.selector ?? "");
  const isZeroCoverage = coverage.coveragePercent === 0;
  const isLowCoverage = coverage.coveragePercent > 0 && coverage.coveragePercent < 5;

  // Safelisted selectors → always LOW (never block on universal/reset patterns)
  if (safelisted) {
    return buildFinding(coverage, attribution, auditId, "low", "risky", is404);
  }

  // Found in live DOM snapshots → demote to LOW for theme files
  // (The selector is referenced in HTML, CDP just didn't cover it this visit)
  if (foundInDomSnapshots && attribution.source !== "shopify_app") {
    return buildFinding(coverage, attribution, auditId, "low", "risky", is404);
  }

  // ── Source-aware HIGH/MEDIUM decision ─────────────────────────────────────
  if (isZeroCoverage && totalTemplatesChecked > 0) {

    if (attribution.source === "shopify_app" && !foundInDomSnapshots) {
      // External app asset, 0% everywhere, not in DOM → HIGH (genuine orphan)
      confidence = "high";
      removalRisk = "safe";
      return buildFinding(coverage, attribution, auditId, confidence, removalRisk, is404);
    }

    // Theme or unknown source: max confidence is MEDIUM.
    // Tailwind/utility-first CSS generates thousands of classes; many won't
    // appear in CDP coverage but are legitimately active in JS-driven states.
    if (attribution.source === "theme" || attribution.source === "unknown") {
      if (!foundInDomSnapshots) {
        // 0% coverage + not in DOM → MEDIUM (worth reviewing, but not auto-purge)
        confidence = "medium";
        removalRisk = "moderate";
        return buildFinding(coverage, attribution, auditId, confidence, removalRisk, is404);
      } else {
        // Found in DOM → LOW
        return buildFinding(coverage, attribution, auditId, "low", "risky", is404);
      }
    }

    // External app found in DOM → MEDIUM (inconclusive)
    if (attribution.source === "shopify_app" && foundInDomSnapshots) {
      confidence = "medium";
      removalRisk = "moderate";
      return buildFinding(coverage, attribution, auditId, confidence, removalRisk, is404);
    }
  }

  // Low coverage (> 0% but < 5%) → MEDIUM
  if (isLowCoverage) {
    confidence = "medium";
    removalRisk = "moderate";
    return buildFinding(coverage, attribution, auditId, confidence, removalRisk, is404);
  }

  // Coverage ≥ 5% → LOW (not meaningfully unused)
  confidence = "low";
  removalRisk = "risky";
  return buildFinding(coverage, attribution, auditId, confidence, removalRisk, is404);
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function buildFinding(
  coverage: SelectorCoverage,
  attribution: AssetAttribution,
  auditId: string,
  confidence: OrphanConfidence,
  removalRisk: RemovalRisk,
  is404?: boolean
): OrphanFinding {
  return {
    id: crypto.randomUUID(),
    auditId,
    type: attribution.type,
    selector: coverage.selector,
    fileUrl: coverage.fileUrl,
    sourceApp: attribution.sourceApp,
    cdpCoveragePercent: coverage.coveragePercent,
    confidence,
    removalRisk,
    estimatedPayloadBytes: coverage.totalBytes,
    reason: buildReason(coverage, attribution, confidence, is404),
    approvedForPurge: false,
  };
}

function buildReason(
  coverage: SelectorCoverage,
  attribution: AssetAttribution,
  confidence: OrphanConfidence,
  is404?: boolean
): string {
  const parts: string[] = [];

  if (is404) {
    parts.push("asset returned HTTP 404 (dead reference)");
  }

  // Source label
  const sourceLabel: Record<string, string> = {
    theme: "theme asset",
    shopify_app: `app asset (${attribution.sourceApp ?? attribution.cdnPattern ?? "unknown app"})`,
    unknown: "unknown-source asset",
  };
  parts.push(sourceLabel[attribution.source] ?? attribution.source);

  if (confidence === "high" && attribution.source === "shopify_app") {
    parts.push("0% coverage across all templates; not found in DOM snapshots");
  } else if (confidence === "medium" && attribution.source === "theme") {
    parts.push("0% CDP coverage; theme file capped at MEDIUM (utility classes may be in use)");
  }

  if (coverage.selector) {
    parts.push(`CDP coverage: ${coverage.coveragePercent.toFixed(2)}%`);
  }

  if (coverage.totalBytes > 0) {
    parts.push(`${coverage.totalBytes} bytes`);
  }

  return parts.join("; ");
}
