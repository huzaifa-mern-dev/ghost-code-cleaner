"use strict";
// ─────────────────────────────────────────────
// Shopify Template Types
// ─────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.COVERAGE_THRESHOLDS = exports.QUEUE_NAMES = exports.APP_CDN_PATTERNS = exports.SHOPIFY_TEMPLATES = void 0;
exports.SHOPIFY_TEMPLATES = [
    "index",
    "product",
    "collection",
    "cart",
    "page",
    "blog",
    "article",
    "search",
    "404",
];
// ─────────────────────────────────────────────
// Known App CDN Patterns
// Add patterns here as they are discovered
// Format: { pattern: RegExp, appName: string }
// ─────────────────────────────────────────────
exports.APP_CDN_PATTERNS = [];
// ─────────────────────────────────────────────
// Queue Names
// ─────────────────────────────────────────────
exports.QUEUE_NAMES = {
    AUDIT: "audit",
    PURGE: "purge",
    NOTIFICATION: "notification",
};
// ─────────────────────────────────────────────
// CDP Coverage Thresholds
// ─────────────────────────────────────────────
exports.COVERAGE_THRESHOLDS = {
    HIGH_CONFIDENCE: 2, // < 2% used → high confidence orphan
    MEDIUM_CONFIDENCE: 10, // < 10% used → medium confidence
};
//# sourceMappingURL=constants.js.map