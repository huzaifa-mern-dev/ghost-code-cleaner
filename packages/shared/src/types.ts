// ─────────────────────────────────────────────
// Domain Types
// ─────────────────────────────────────────────

export type OrphanConfidence = "high" | "medium" | "low";
import type { AssetSource } from "./constants";
export type { AssetSource } from "./constants";
export type RemovalRisk = "safe" | "moderate" | "risky";
export type AuditStatus = "pending" | "running" | "completed" | "failed";
export type PurgeStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "rolled_back";
export type PlanTier = "free" | "starter" | "growth" | "agency";
export type AssetType = "css" | "js";

// ─────────────────────────────────────────────
// Orphan Detection
// ─────────────────────────────────────────────

export interface OrphanFinding {
  id: string;
  auditId: string;
  type: AssetType;
  selector?: string;
  fileUrl: string;
  sourceApp?: string;
  cdpCoveragePercent?: number;
  confidence: OrphanConfidence;
  removalRisk: RemovalRisk;
  estimatedPayloadBytes?: number;
  reason?: string;
  approvedForPurge: boolean;
}

export interface AuditSummary {
  totalAssetsScanned: number;
  orphanedCssCount: number;
  orphanedJsCount: number;
  estimatedWastedBytes: number;
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  lowConfidenceCount: number;
}

export interface AuditReport {
  id: string;
  storeId: string;
  status: AuditStatus;
  startedAt: Date;
  completedAt?: Date;
  summary?: AuditSummary;
  crawlDurationMs?: number;
  findings: OrphanFinding[];
}

// ─────────────────────────────────────────────
// Crawler Outputs
// ─────────────────────────────────────────────

export interface SelectorCoverage {
  selector: string;
  usedBytes: number;
  totalBytes: number;
  coveragePercent: number;
  fileUrl: string;
}

export interface DOMSnapshot {
  url: string;
  html: string;
  timestamp: Date;
  styleSheets: string[];
  scripts: string[];
  selectorCoverages: SelectorCoverage[];
}

export interface AssetAttribution {
  fileUrl: string;
  type: AssetType;
  /**
   * Where this asset comes from:
   *   "theme"       — the store's own theme CSS (max confidence: MEDIUM)
   *   "shopify_app" — a third-party app CDN (can be HIGH if 0% + not in DOM)
   *   "unknown"     — can't determine source (max confidence: MEDIUM)
   */
  source: AssetSource;
  sourceApp?: string;
  cdnPattern?: string;
  isKnownAppCdn: boolean;
  /** True if the asset is served from a Shopify platform domain (always excluded from orphan findings) */
  isShopifyPlatform: boolean;
}

// ─────────────────────────────────────────────
// Shopify
// ─────────────────────────────────────────────

export interface ShopifyTheme {
  id: number;
  name: string;
  role: "main" | "unpublished" | "demo";
  createdAt: string;
  updatedAt: string;
  previewable: boolean;
  processing: boolean;
}

// ─────────────────────────────────────────────
// Queue
// ─────────────────────────────────────────────

export interface PurgeJob {
  id: string;
  storeId: string;
  auditId: string;
  sourceThemeId: number;
  duplicateThemeId?: number;
  status: PurgeStatus;
  diffJson?: Record<string, unknown>;
  previewUrl?: string;
  createdAt: Date;
  completedAt?: Date;
}
