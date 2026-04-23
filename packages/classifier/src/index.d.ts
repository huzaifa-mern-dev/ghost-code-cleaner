import type { OrphanFinding, SelectorCoverage, AssetAttribution } from "@ghost/shared";
export interface ClassifyInput {
    coverage: SelectorCoverage;
    attribution: AssetAttribution;
    auditId: string;
}
/**
 * Classifies a single asset as an orphan and assigns a confidence score
 * based on CDP coverage percentage, CDN pattern match, and other signals.
 *
 * Confidence levels:
 *   high   — coverage < HIGH_CONFIDENCE threshold (2%) or known app CDN
 *   medium — coverage < MEDIUM_CONFIDENCE threshold (10%)
 *   low    — everything else
 *
 * Removal risk:
 *   safe     — known app CDN + 0% coverage
 *   moderate — < 10% coverage
 *   risky    — > 10% coverage but flagged for another reason
 */
export declare function classifyOrphan(input: ClassifyInput): OrphanFinding;
//# sourceMappingURL=index.d.ts.map