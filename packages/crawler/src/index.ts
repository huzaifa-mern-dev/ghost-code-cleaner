// ─────────────────────────────────────────────
// @ghost/crawler — Public API
// ─────────────────────────────────────────────

// Browser lifecycle
export { launchBrowser, newPage, closeBrowser } from "./browser";
export type { BrowserConfig, PageConfig } from "./browser";

// URL discovery & crawl planning
export { SHOPIFY_TEMPLATES, discoverDynamicUrls, buildCrawlPlan } from "./url-discovery";
export type { TemplateDefinition, TemplateConfig } from "./url-discovery";

// Page loading & interaction simulation
export { loadPageFully, simulateInteractions } from "./page-loader";

// Network monitoring
export { captureNetworkRequests, find404Scripts, detectTrackingPixels } from "./network-monitor";
export type { NetworkRequest } from "./network-monitor";

// CSS Coverage
export { startCoverage, stopCoverage, parseCoverageToSelectors, buildFullCoverageMap } from "./css-coverage";
export type { CSSCoverageEntry, SelectorCoverage } from "./css-coverage";

// DOM Snapshot
export { captureDOMSnapshot, snapshotToJSON } from "./dom-snapshot";
export type { DOMElement, DOMSnapshot, DOMSnapshotJSON } from "./dom-snapshot";

// Audit runner
export { runFullAudit } from "./audit-runner";
export type { AuditOptions, ExtendedAuditReport, ExtendedAuditSummary } from "./audit-runner";
