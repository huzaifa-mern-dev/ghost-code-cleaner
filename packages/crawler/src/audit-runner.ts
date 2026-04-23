import { writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import type { Browser } from "puppeteer";

import type { AuditReport, OrphanFinding, AuditSummary } from "@ghost/shared";
import { attributeAsset } from "@ghost/analyzer";
import { classifyOrphan } from "@ghost/classifier";

import { launchBrowser, closeBrowser, newPage } from "./browser";
import { buildCrawlPlan, type TemplateConfig } from "./url-discovery";
import { captureDOMSnapshot, type DOMSnapshot, snapshotToJSON } from "./dom-snapshot";
import { buildFullCoverageMap, type SelectorCoverage } from "./css-coverage";
import { captureNetworkRequests, find404Scripts, type NetworkRequest } from "./network-monitor";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface AuditOptions {
  /** Write the full report JSON to this file path */
  outputPath?: string;
  /** Limit crawl to specific template names */
  templates?: string[];
  /** Run in headed (visible) mode for debugging */
  headless?: boolean;
  /** Progress callback fired per template */
  onProgress?: (templateName: string) => void;
}

export interface ExtendedAuditReport extends AuditReport {
  summary: ExtendedAuditSummary;
  snapshots: ReturnType<typeof snapshotToJSON>[];
  networkIssues: {
    notFound404: NetworkRequest[];
    trackingPixels: NetworkRequest[];
  };
}

export interface ExtendedAuditSummary extends AuditSummary {
  totalFindingsCount: number;
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  lowConfidenceCount: number;
  totalPayloadSavingsKB: number;
  estimatedLCPImprovementMs: number;
  estimatedTBTImprovementMs: number;
  templatesAudited: number;
  crawlDurationMs: number;
}

// ─────────────────────────────────────────────
// Concurrency Helpers
// ─────────────────────────────────────────────

/**
 * Runs async tasks with a cap on concurrent in-flight tasks.
 */
async function pLimit<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<T[]> {
  const results: T[] = [];
  const queue = [...tasks];
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (queue.length > 0) {
      const task = queue.shift();
      if (task) results.push(await task());
    }
  });
  await Promise.all(workers);
  return results;
}

// ─────────────────────────────────────────────
// Per-Template Crawl Task
// ─────────────────────────────────────────────

interface TemplateCrawlResult {
  snapshot: DOMSnapshot;
  networkRequests: NetworkRequest[];
}

async function crawlTemplate(
  browser: Browser,
  template: TemplateConfig,
  onProgress?: (name: string) => void
): Promise<TemplateCrawlResult> {
  onProgress?.(template.name);

  // Snapshot and network capture share one page; coverage uses dedicated pages
  const page = await newPage(browser);
  let networkRequests: NetworkRequest[] = [];
  let snapshot: DOMSnapshot;

  try {
    // Capture network requests while loading (attaches listener before nav)
    networkRequests = await captureNetworkRequests(page, template.url);

    // Snapshot is captured on the already-loaded page (avoids second navigation)
    snapshot = {
      template: template.name,
      url: template.url,
      elements: await page.evaluate(() => {
        const INLINE_HANDLERS = ["onclick", "onchange", "onsubmit", "onload", "onerror"];
        return Array.from(document.querySelectorAll("*")).map((el) => {
          const dataAttributes: Record<string, string> = {};
          for (const attr of Array.from(el.attributes)) {
            if (attr.name.startsWith("data-")) {
              dataAttributes[attr.name] = attr.value;
            }
          }
          return {
            tag: el.tagName.toLowerCase(),
            id: el.id ?? "",
            classes: Array.from(el.classList),
            dataAttributes,
            hasInlineHandlers: INLINE_HANDLERS.some((h) => el.hasAttribute(h)),
          };
        });
      }),
      allClassNames: new Set<string>(),
      allIds: new Set<string>(),
      capturedAt: new Date(),
    };

    // Build aggregate sets
    for (const el of snapshot.elements) {
      for (const cls of el.classes) { if (cls) snapshot.allClassNames.add(cls); }
      if (el.id) snapshot.allIds.add(el.id);
    }
  } finally {
    await page.close();
  }

  return { snapshot, networkRequests };
}

// ─────────────────────────────────────────────
// DOM Snapshot Cross-Check Helper
// ─────────────────────────────────────────────

/**
 * Builds a global set of all class names and IDs seen across every
 * crawled template DOM snapshot. Used to cross-check CSS selectors.
 */
function buildGlobalDomSets(snapshots: DOMSnapshot[]): {
  globalClassNames: Set<string>;
  globalIds: Set<string>;
} {
  const globalClassNames = new Set<string>();
  const globalIds = new Set<string>();

  for (const snap of snapshots) {
    for (const cls of snap.allClassNames) globalClassNames.add(cls);
    for (const id of snap.allIds) globalIds.add(id);
  }

  return { globalClassNames, globalIds };
}

/**
 * Checks whether a CSS selector string appears to reference any class or ID
 * that exists in the global DOM snapshot sets.
 *
 * Uses a simple token extraction: splits selector on whitespace and common
 * combinators, then checks each token against the global DOM sets.
 */
function isSelectorInDom(
  selector: string,
  globalClassNames: Set<string>,
  globalIds: Set<string>
): boolean {
  // Extract all .class and #id tokens from the selector string
  const classTokens = (selector.match(/\.([a-zA-Z0-9_-]+)/g) ?? []).map((t) =>
    t.slice(1)
  );
  const idTokens = (selector.match(/#([a-zA-Z0-9_-]+)/g) ?? []).map((t) =>
    t.slice(1)
  );

  // If any class token is present in the live DOM, this selector is active
  for (const cls of classTokens) {
    if (globalClassNames.has(cls)) return true;
  }
  // If any ID token is present in the live DOM, this selector is active
  for (const id of idTokens) {
    if (globalIds.has(id)) return true;
  }

  return false;
}

// ─────────────────────────────────────────────
// Main Audit Runner
// ─────────────────────────────────────────────

/**
 * Runs a full Ghost Code Cleaner audit against a Shopify store URL.
 *
 * Pipeline:
 *   1. Launch browser
 *   2. Build crawl plan (discover all template URLs)
 *   3. Crawl templates in parallel (max 3 concurrent)
 *      - DOM snapshot capture
 *      - Network request monitoring
 *   4. Run CSS coverage across all templates (sequential, one page per template)
 *   5. Attribute assets to known app CDN patterns / Shopify platform domains
 *   6. Classify orphans with recalibrated confidence scoring:
 *      - HIGH: CSS selector with 0% coverage across ALL templates + not in DOM + not safelisted
 *      - HIGH: JS/stylesheet that returned HTTP 404
 *      - MEDIUM: low coverage (<5%) or DOM-inconclusive
 *      - LOW: informational only
 *   7. Build extended report with performance impact estimates
 *   8. Optionally write report JSON to disk
 */
export async function runFullAudit(
  storeUrl: string,
  storeId?: string,
  options: AuditOptions = {}
): Promise<ExtendedAuditReport> {
  const { outputPath, templates: templateFilter, headless = true, onProgress } = options;

  const auditId = randomUUID();
  const resolvedStoreId = storeId ?? randomUUID();
  const startedAt = new Date();
  const startMs = Date.now();

  let browser!: Browser;

  try {
    // ── Step 1: Launch browser ───────────────────────────────────────────
    browser = await launchBrowser({ headless });

    // ── Step 2: Build crawl plan ─────────────────────────────────────────
    let crawlPlan = await buildCrawlPlan(storeUrl);

    if (templateFilter && templateFilter.length > 0) {
      crawlPlan = crawlPlan.filter((t) => templateFilter.includes(t.name));
    }

    if (crawlPlan.length === 0) {
      throw new Error(`No reachable templates found for ${storeUrl}`);
    }

    const totalTemplatesChecked = crawlPlan.length;

    // Extract the store's hostname so attributeAsset can identify theme assets
    let storeHostname = "";
    try {
      storeHostname = new URL(storeUrl).hostname;
    } catch { /* ignore malformed URL */ }

    // ── Step 3: Crawl templates (max 3 concurrent) ───────────────────────
    const crawlTasks = crawlPlan.map(
      (template) => () => crawlTemplate(browser, template, onProgress)
    );

    const crawlResults = await pLimit(crawlTasks, 3);

    const snapshots = crawlResults.map((r) => r.snapshot);
    const allNetworkRequests = crawlResults.flatMap((r) => r.networkRequests);

    // Build global DOM sets from all snapshots for cross-referencing
    const { globalClassNames, globalIds } = buildGlobalDomSets(snapshots);

    // ── Step 4: CSS coverage across all templates ────────────────────────
    const coverageMap = await buildFullCoverageMap(browser, crawlPlan);

    // Build a size lookup from captured network data: sourceUrl → bytes
    const stylesheetSizes = new Map<string, number>();
    for (const req of allNetworkRequests) {
      if (req.resourceType === "stylesheet" && req.size > 0) {
        stylesheetSizes.set(req.url, req.size);
      }
    }

    // Build a selector-count-per-file map so we can estimate per-selector bytes
    const selectorsPerFile = new Map<string, number>();
    for (const [, coverage] of coverageMap) {
      const count = selectorsPerFile.get(coverage.sourceFile) ?? 0;
      selectorsPerFile.set(coverage.sourceFile, count + 1);
    }

    // ── Step 5: Attribute assets ─────────────────────────────────────────
    // ── Step 6: Classify CSS orphans ─────────────────────────────────────
    const findings: OrphanFinding[] = [];

    for (const [, coverage] of coverageMap) {
      // ── CRITICAL FIX #1: Skip entries where sourceFile is a JS URL ──────
      // CSS coverage CDP only tracks stylesheets. If a sourceFile URL ends in
      // .js (or other non-CSS extension), it means an inline <style> block or
      // a data: URI was captured and mis-attributed. These are NOT JS orphans.
      // We skip them here; genuine 404 JS orphans are handled below.
      const strippedUrl = coverage.sourceFile.split("?")[0];
      if (!strippedUrl.endsWith(".css") && !strippedUrl.endsWith(".css.liquid")) {
        continue;
      }

      // Only flag selectors that are unused in ALL templates they appeared in
      const isCompletelyUnused = coverage.usedInTemplates.length === 0;
      if (!isCompletelyUnused) continue;

      const attribution = attributeAsset(coverage.sourceFile, storeHostname);

      // Skip Shopify platform assets entirely — they are never orphans
      if (attribution.isShopifyPlatform) continue;

      // ── Cross-check against live DOM snapshots ───────────────────────────
      const foundInDomSnapshots = isSelectorInDom(
        coverage.selector,
        globalClassNames,
        globalIds
      );

      const fileBytes = stylesheetSizes.get(coverage.sourceFile) ?? 0;
      const selectorCount = selectorsPerFile.get(coverage.sourceFile) ?? 1;
      const estimatedBytes = selectorCount > 0
        ? Math.round(fileBytes / selectorCount)
        : 0;

      const sharedCoverage = {
        selector: coverage.selector,
        usedBytes: 0,
        totalBytes: estimatedBytes,
        coveragePercent: coverage.coveragePercent,
        fileUrl: coverage.sourceFile,
      };

      const finding = classifyOrphan({
        coverage: sharedCoverage,
        attribution,
        auditId,
        totalTemplatesChecked,
        foundInDomSnapshots,
        is404: false,
      });

      findings.push(finding);
    }

    // ── CRITICAL FIX #4: 404 JS/CSS findings (the ONLY legitimate HIGH JS) ──
    const notFound404 = find404Scripts(allNetworkRequests);
    for (const req of notFound404) {
      const attribution = attributeAsset(req.url, storeHostname);
      findings.push({
        id: randomUUID(),
        auditId,
        type: attribution.type,
        fileUrl: req.url,
        cdpCoveragePercent: 0,
        confidence: "high",
        removalRisk: "safe",
        estimatedPayloadBytes: 0,
        reason: `asset returned HTTP 404 (dead broken reference)`,
        approvedForPurge: false,
      });
    }

    // ── Step 7: Build summary ────────────────────────────────────────────
    const highFindings = findings.filter((f) => f.confidence === "high");
    const mediumFindings = findings.filter((f) => f.confidence === "medium");
    const lowFindings = findings.filter((f) => f.confidence === "low");

    const impactFindings = [...highFindings, ...mediumFindings];
    const totalPayloadBytes = impactFindings.reduce(
      (sum, f) => sum + (f.estimatedPayloadBytes ?? 0),
      0
    );
    const totalPayloadSavingsKB = totalPayloadBytes / 1024;

    const trackingPixels = allNetworkRequests.filter((r) => {
      if (r.resourceType !== "image") return false;
      try {
        const host = new URL(r.url).hostname;
        return [
          "google-analytics.com", "facebook.com", "doubleclick.net",
          "hotjar.com", "segment.com", "mixpanel.com", "amplitude.com",
          "klaviyo.com",
        ].some((d) => host.includes(d));
      } catch { return false; }
    });

    // LCP improvement: ~2.5ms per KB of removed render-blocking CSS/JS
    const rawLCP = totalPayloadSavingsKB * 2.5;
    const estimatedLCPImprovementMs = Math.min(Math.round(rawLCP), 2000);

    // TBT improvement: each 404 script causes a ~150ms main-thread block
    const estimatedTBTImprovementMs = notFound404.length * 150;

    const crawlDurationMs = Date.now() - startMs;

    const summary: ExtendedAuditSummary = {
      totalAssetsScanned: coverageMap.size,
      orphanedCssCount: findings.filter((f) => f.type === "css").length,
      orphanedJsCount: findings.filter((f) => f.type === "js").length,
      estimatedWastedBytes: totalPayloadBytes,
      totalFindingsCount: findings.length,
      highConfidenceCount: highFindings.length,
      mediumConfidenceCount: mediumFindings.length,
      lowConfidenceCount: lowFindings.length,
      totalPayloadSavingsKB: Math.round(totalPayloadSavingsKB * 100) / 100,
      estimatedLCPImprovementMs,
      estimatedTBTImprovementMs,
      templatesAudited: crawlPlan.length,
      crawlDurationMs,
    };

    const report: ExtendedAuditReport = {
      id: auditId,
      storeId: resolvedStoreId,
      status: "completed",
      startedAt,
      completedAt: new Date(),
      crawlDurationMs,
      summary,
      findings,
      snapshots: snapshots.map(snapshotToJSON),
      networkIssues: {
        notFound404,
        trackingPixels,
      },
    };

    // ── Step 8: Persist report ───────────────────────────────────────────
    if (outputPath) {
      await writeFile(
        outputPath,
        JSON.stringify(report, null, 2),
        "utf8"
      );
    }

    return report;
  } finally {
    if (browser) await closeBrowser(browser);
  }
}
