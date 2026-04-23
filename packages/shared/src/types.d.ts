export type OrphanConfidence = "high" | "medium" | "low";
export type RemovalRisk = "safe" | "moderate" | "risky";
export type AuditStatus = "pending" | "running" | "completed" | "failed";
export type PurgeStatus = "pending" | "running" | "completed" | "failed" | "rolled_back";
export type PlanTier = "free" | "starter" | "growth" | "agency";
export type AssetType = "css" | "js";
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
    sourceApp?: string;
    cdnPattern?: string;
    isKnownAppCdn: boolean;
}
export interface ShopifyTheme {
    id: number;
    name: string;
    role: "main" | "unpublished" | "demo";
    createdAt: string;
    updatedAt: string;
    previewable: boolean;
    processing: boolean;
}
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
//# sourceMappingURL=types.d.ts.map