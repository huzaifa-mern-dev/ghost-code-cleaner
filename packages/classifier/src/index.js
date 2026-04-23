"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyOrphan = classifyOrphan;
const shared_1 = require("@ghost/shared");
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
function classifyOrphan(input) {
    const { coverage, attribution, auditId } = input;
    let confidence;
    let removalRisk;
    if (attribution.isKnownAppCdn ||
        coverage.coveragePercent < shared_1.COVERAGE_THRESHOLDS.HIGH_CONFIDENCE) {
        confidence = "high";
        removalRisk = attribution.isKnownAppCdn ? "safe" : "moderate";
    }
    else if (coverage.coveragePercent < shared_1.COVERAGE_THRESHOLDS.MEDIUM_CONFIDENCE) {
        confidence = "medium";
        removalRisk = "moderate";
    }
    else {
        confidence = "low";
        removalRisk = "risky";
    }
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
        reason: buildReason(coverage, attribution),
        approvedForPurge: false,
    };
}
function buildReason(coverage, attribution) {
    const parts = [];
    if (attribution.isKnownAppCdn) {
        parts.push(`matches known app CDN pattern (${attribution.cdnPattern ?? "unknown"})`);
    }
    parts.push(`CDP coverage: ${coverage.coveragePercent.toFixed(2)}%`);
    if (coverage.totalBytes > 0) {
        parts.push(`${coverage.totalBytes} bytes unused`);
    }
    return parts.join("; ");
}
//# sourceMappingURL=index.js.map