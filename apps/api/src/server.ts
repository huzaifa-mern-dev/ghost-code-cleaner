import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import { generateAuthUrl, validateCallback, ShopifyAdminClient } from "@ghost/shopify";
import { runFullAudit } from "@ghost/crawler";
import { duplicateTheme, applyFindingsToTheme, generatePurgeDiff, formatDiffForDisplay, rollbackPurge } from "@ghost/theme-editor";
import type { OrphanFinding } from "@ghost/shared";

// ─────────────────────────────────────────────
// Singletons
// ─────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3001);
const NODE_ENV = process.env.NODE_ENV ?? "development";
const prisma = new PrismaClient();

// ─────────────────────────────────────────────
// Express Application
// ─────────────────────────────────────────────

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));

// CORS — allow both Next.js dev ports
app.use(
  cors({
    origin:
      NODE_ENV === "production"
        ? process.env.SHOPIFY_APP_URL
        : ["http://localhost:3000", "http://localhost:3002"],
    credentials: true,
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────────
// Health
// ─────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    version: process.env.npm_package_version ?? "0.1.0",
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/v1", (_req: Request, res: Response) => {
  res.json({ service: "ghost-code-cleaner-api", version: "1", status: "operational" });
});

// ─────────────────────────────────────────────
// Shopify OAuth
// ─────────────────────────────────────────────

app.get("/auth", (req: Request, res: Response): void => {
  const shop = req.query.shop as string | undefined;
  if (!shop?.trim()) {
    res.status(400).json({ error: "Missing required query parameter: shop", example: "/auth?shop=my-store.myshopify.com" });
    return;
  }
  try {
    const { url, state } = generateAuthUrl(shop.trim());
    console.log(`[ghost-oauth] /auth → shop "${shop}" state:${state}`);
    res.redirect(url);
  } catch (err) {
    res.status(500).json({ error: "Failed to generate auth URL", detail: String(err) });
  }
});

app.get("/auth/callback", async (req: Request, res: Response): Promise<void> => {
  const { code, shop, state, hmac, ...rest } = req.query as Record<string, string>;
  const missing = (["code", "shop", "state", "hmac"] as const).filter((k) => !req.query[k]);
  if (missing.length > 0) { res.status(400).json({ error: `Missing OAuth params: ${missing.join(", ")}` }); return; }
  try {
    const { accessToken, shop: cleanShop } = await validateCallback({ code, shop, state, hmac, ...rest });
    // Upsert store in DB
    await prisma.store.upsert({
      where: { shopDomain: cleanShop },
      update: { accessToken },
      create: { shopDomain: cleanShop, accessToken, planTier: "free" },
    });
    console.log(`[ghost-oauth] ✅ OAuth complete — stored credentials for ${cleanShop}`);
    res.redirect("/auth/success");
  } catch (err) {
    console.error("[ghost-oauth] /auth/callback error:", err);
    res.status(400).json({ error: "OAuth callback failed", detail: NODE_ENV !== "production" ? String(err) : undefined });
  }
});

app.get("/auth/success", (_req: Request, res: Response) => {
  res.json({ success: true, message: "Ghost Code Cleaner connected successfully!", next: "Return to your Shopify admin to start your first audit." });
});

// ─────────────────────────────────────────────
// Audit Routes
// ─────────────────────────────────────────────

/**
 * POST /api/audits
 * Body: { shop: string }
 * Returns immediately with auditId, runs audit in background.
 */
app.post("/api/audits", async (req: Request, res: Response): Promise<void> => {
  const { shop } = req.body as { shop?: string };
  if (!shop?.trim()) {
    res.status(400).json({ error: "Request body must include: { shop: string }" });
    return;
  }

  const store = await prisma.store.findUnique({ where: { shopDomain: shop.trim() } });
  if (!store) {
    res.status(404).json({ error: `Store not found: ${shop}. Complete OAuth install first.` });
    return;
  }

  // Create audit record
  const audit = await prisma.audit.create({
    data: { storeId: store.id, status: "running" },
  });

  // Return immediately
  res.json({ auditId: audit.id, status: "running", message: "Audit started. Poll GET /api/audits/:auditId for results." });

  // Run audit asynchronously
  runAuditBackground(store.shopDomain, audit.id).catch((err) =>
    console.error(`[audit:${audit.id}] Unhandled error:`, err)
  );
});

async function runAuditBackground(shopDomain: string, auditId: string) {
  try {
    console.log(`[audit:${auditId}] Starting crawl of https://${shopDomain}`);

    const report = await runFullAudit(`https://${shopDomain}`, auditId);

    // Persist findings in batches of 50
    const findings = report.findings;
    for (let i = 0; i < findings.length; i += 50) {
      const batch = findings.slice(i, i + 50);
      await prisma.finding.createMany({
        data: batch.map((f) => ({
          id: f.id,
          auditId,
          type: f.type,
          selector: f.selector ?? null,
          fileUrl: f.fileUrl,
          sourceApp: f.sourceApp ?? null,
          cdpCoveragePercent: f.cdpCoveragePercent ?? null,
          confidence: f.confidence,
          removalRisk: f.removalRisk,
          estimatedPayloadBytes: f.estimatedPayloadBytes ?? null,
          reason: f.reason ?? null,
          approvedForPurge: false,
        })),
        skipDuplicates: true,
      });
    }

    const s = report.summary;
    await prisma.audit.update({
      where: { id: auditId },
      data: {
        status: "completed",
        completedAt: new Date(),
        crawlDurationMs: s.crawlDurationMs,
        summary: {
          totalFindings: s.totalFindingsCount,
          highCount: s.highConfidenceCount,
          mediumCount: s.mediumConfidenceCount,
          lowCount: s.lowConfidenceCount,
          payloadSavingsKB: s.totalPayloadSavingsKB,
          estimatedLCPImprovementMs: s.estimatedLCPImprovementMs,
          templatesAudited: s.templatesAudited,
        },
      },
    });

    console.log(`[audit:${auditId}] ✅ Complete — ${findings.length} findings, ${s.totalPayloadSavingsKB.toFixed(1)} KB`);
  } catch (err) {
    console.error(`[audit:${auditId}] ❌ Failed:`, err);
    await prisma.audit.update({
      where: { id: auditId },
      data: { status: "failed", completedAt: new Date() },
    }).catch(() => {});
  }
}

/**
 * GET /api/audits/:auditId
 */
app.get("/api/audits/:auditId", async (req: Request, res: Response): Promise<void> => {
  const auditId = req.params.auditId as string;
  const audit = await prisma.audit.findUnique({
    where: { id: auditId },
    include: { findings: true },
  });
  if (!audit) { res.status(404).json({ error: "Audit not found" }); return; }

  const sum = (audit.summary ?? {}) as Record<string, number>;
  const findings = (audit as typeof audit & { findings: { id: string }[] }).findings ?? [];
  res.json({
    auditId: audit.id,
    status: audit.status,
    startedAt: audit.startedAt,
    completedAt: audit.completedAt,
    totalFindings: sum.totalFindings ?? findings.length,
    highCount: sum.highCount ?? 0,
    mediumCount: sum.mediumCount ?? 0,
    lowCount: sum.lowCount ?? 0,
    payloadSavingsKB: sum.payloadSavingsKB ?? 0,
    estimatedLCPImprovementMs: sum.estimatedLCPImprovementMs ?? 0,
    templatesAudited: sum.templatesAudited ?? 0,
    findings,
  });
});

/**
 * GET /api/audits/:auditId/findings?confidence=HIGH&type=css
 */
app.get("/api/audits/:auditId/findings", async (req: Request, res: Response): Promise<void> => {
  const auditId = req.params.auditId as string;
  const { confidence, type } = req.query as Record<string, string>;

  const findings = await prisma.finding.findMany({
    where: {
      auditId: auditId,
      ...(confidence ? { confidence: confidence.toLowerCase() } : {}),
      ...(type ? { type: type.toLowerCase() } : {}),
    },
    orderBy: [{ confidence: "asc" }, { estimatedPayloadBytes: "desc" }],
  });

  res.json(findings);
});

/**
 * GET /api/stores/:shop/audits
 */
app.get("/api/stores/:shop/audits", async (req: Request, res: Response): Promise<void> => {
  const shop = req.params.shop as string;
  const store = await prisma.store.findUnique({ where: { shopDomain: shop } });
  if (!store) { res.status(404).json({ error: "Store not found" }); return; }

  const audits = await prisma.audit.findMany({
    where: { storeId: store.id },
    orderBy: { startedAt: "desc" },
    take: 10,
  });

  res.json(
    audits.map((a) => {
      const sum = (a.summary ?? {}) as Record<string, number>;
      return {
        auditId: a.id,
        status: a.status,
        startedAt: a.startedAt,
        completedAt: a.completedAt,
        totalFindings: sum.totalFindings ?? 0,
        highCount: sum.highCount ?? 0,
        mediumCount: sum.mediumCount ?? 0,
        lowCount: sum.lowCount ?? 0,
        payloadSavingsKB: sum.payloadSavingsKB ?? 0,
        estimatedLCPImprovementMs: sum.estimatedLCPImprovementMs ?? 0,
        templatesAudited: sum.templatesAudited ?? 0,
      };
    })
  );
});

// ─────────────────────────────────────────────
// Purge Routes
// ─────────────────────────────────────────────

/**
 * POST /api/purge
 * Body: { auditId: string, findingIds: string[] }
 */
app.post("/api/purge", async (req: Request, res: Response): Promise<void> => {
  const { auditId, findingIds } = req.body as { auditId?: string; findingIds?: string[] };

  if (!auditId || !Array.isArray(findingIds)) {
    res.status(400).json({ error: "Body must include { auditId: string, findingIds: string[] }" });
    return;
  }

  // Load audit → store
  const audit = await prisma.audit.findUnique({ where: { id: auditId }, include: { store: true } });
  if (!audit) { res.status(404).json({ error: "Audit not found" }); return; }

  const store = audit.store;

  // Fetch approved findings from DB
  const dbFindings = findingIds.length > 0 ? await prisma.finding.findMany({
    where: { id: { in: findingIds }, auditId },
  }) : [];

  // ── Discover the live theme ID dynamically via Shopify API ───────────────
  // Falls back to env var if the API call fails (e.g. during local dev without
  // real credentials), then falls back to 0 which will be caught in the bg job.
  let liveThemeId: number;
  try {
    const client = new ShopifyAdminClient(store.shopDomain, store.accessToken);
    const themes = await client.listThemes();
    const mainTheme = themes.find((t) => t.role === "main");
    if (!mainTheme) throw new Error("No live (main) theme found on store");
    liveThemeId = mainTheme.id;
    console.log(`[purge] Live theme: "${mainTheme.name}" (id: ${liveThemeId})`);
  } catch (err) {
    console.warn(`[purge] Could not discover live theme via API: ${String(err)} — using SHOPIFY_LIVE_THEME_ID env var`);
    liveThemeId = Number(process.env.SHOPIFY_LIVE_THEME_ID ?? 0);
    if (!liveThemeId) {
      res.status(500).json({ error: "Could not determine live theme ID. Check store credentials." });
      return;
    }
  }

  // Create PurgeJob
  const purgeJob = await prisma.purgeJob.create({
    data: { storeId: store.id, auditId, sourceThemeId: liveThemeId, status: "running" },
  });

  res.json({ purgeJobId: purgeJob.id, status: "running", message: "Purge started. Poll GET /api/purge/:purgeJobId for results." });

  // Run purge async
  runPurgeBackground(store, purgeJob.id, liveThemeId, dbFindings).catch((err) =>
    console.error(`[purge:${purgeJob.id}] Unhandled error:`, err)
  );
});

async function runPurgeBackground(
  store: { shopDomain: string; accessToken: string },
  purgeJobId: string,
  liveThemeId: number,
  dbFindings: { id: string; type: string; selector: string | null; fileUrl: string; sourceApp: string | null; cdpCoveragePercent: number | null; confidence: string; removalRisk: string; estimatedPayloadBytes: number | null; reason: string | null; approvedForPurge: boolean; auditId: string }[]
) {
  let newThemeId: number | undefined;
  let previewUrl: string | undefined;
  let diffPayload = { files: [], filesModified: 0, selectorsCommented: 0 };

  try {
    const client = new ShopifyAdminClient(store.shopDomain, store.accessToken);

    // Duplicate live theme
    const newTheme = await duplicateTheme(client, liveThemeId, (p) =>
      console.log(`[purge:${purgeJobId}] Copying assets ${p.percent}%`)
    );
    newThemeId = newTheme.id;
    previewUrl = `https://${store.shopDomain}?preview_theme_id=${newTheme.id}`;

    // Map DB findings to OrphanFinding shape
    const findings: OrphanFinding[] = dbFindings.map((f) => ({
      id: f.id,
      auditId: f.auditId,
      type: f.type as "css" | "js",
      selector: f.selector ?? undefined,
      fileUrl: f.fileUrl,
      sourceApp: f.sourceApp ?? undefined,
      cdpCoveragePercent: f.cdpCoveragePercent ?? 0,
      confidence: f.confidence as "high" | "medium" | "low",
      removalRisk: f.removalRisk as "safe" | "moderate" | "risky",
      estimatedPayloadBytes: f.estimatedPayloadBytes ?? 0,
      reason: f.reason ?? undefined,
      approvedForPurge: f.approvedForPurge,
    }));

    // Apply comments to duplicate theme
    let commentResults: Awaited<ReturnType<typeof applyFindingsToTheme>> = [];
    try {
      commentResults = await applyFindingsToTheme(client, newTheme.id, findings, (done, total) =>
        console.log(`[purge:${purgeJobId}] Files processed ${done}/${total}`)
      );
    } catch (err) {
      console.error(`[purge:${purgeJobId}] Error applying findings:`, err);
    }

    // Generate diff
    diffPayload.files = generatePurgeDiff(commentResults) as never[];
    diffPayload.filesModified = commentResults.length;
    diffPayload.selectorsCommented = commentResults.reduce((sum, r) => sum + r.selectorsCommented, 0);

    // Mark findings as approved
    await prisma.finding.updateMany({
      where: { id: { in: dbFindings.map((f) => f.id) } },
      data: { approvedForPurge: true },
    });

    console.log(`[purge:${purgeJobId}] ✅ Applied findings to theme ${newTheme.id}, ${diffPayload.filesModified} files modified, ${diffPayload.selectorsCommented} selectors commented`);
  } catch (err) {
    console.error(`[purge:${purgeJobId}] ❌ Failed:`, err);
    await prisma.purgeJob.update({
      where: { id: purgeJobId },
      data: { status: "failed", completedAt: new Date() },
    }).catch(() => {});
    return;
  } finally {
    if (newThemeId) {
      await prisma.purgeJob.update({
        where: { id: purgeJobId },
        data: {
          status: "completed",
          duplicateThemeId: newThemeId,
          previewUrl,
          diffJson: diffPayload as object,
          completedAt: new Date(),
        },
      }).catch((e) => console.error(`[purge:${purgeJobId}] Error updating final status:`, e));
    }
  }
}

/**
 * GET /api/purge/:purgeJobId
 */
app.get("/api/purge/:purgeJobId", async (req: Request, res: Response): Promise<void> => {
  const purgeJobId = req.params.purgeJobId as string;
  const job = await prisma.purgeJob.findUnique({ where: { id: purgeJobId } });
  if (!job) { res.status(404).json({ error: "Purge job not found" }); return; }

  // Reconstruct human-readable diff text + stats from the stored diffJson wrapper
  type DiffPayload = { files?: object[]; filesModified?: number; selectorsCommented?: number };
  const payload = (job.diffJson ?? {}) as DiffPayload;
  const rawFiles = Array.isArray(payload.files) ? payload.files : Array.isArray(job.diffJson) ? (job.diffJson as object[]) : [];

  // Build diff text string
  let diffText: string | null = null;
  if (rawFiles.length > 0) {
    try {
      // rawFiles are already FileDiff-shaped objects saved to JSON
      diffText = formatDiffForDisplay(rawFiles as Parameters<typeof formatDiffForDisplay>[0]);
    } catch {
      diffText = null;
    }
  }

  res.json({
    id: job.id,
    auditId: job.auditId,
    status: job.status,
    sourceThemeId: job.sourceThemeId ? Number(job.sourceThemeId) : null,
    duplicateThemeId: job.duplicateThemeId ? Number(job.duplicateThemeId) : null,
    previewUrl: job.previewUrl,
    filesModified: payload.filesModified ?? rawFiles.length,
    selectorsCommented: payload.selectorsCommented ?? 0,
    diff: diffText,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  });
});

/**
 * DELETE /api/purge/:purgeJobId/rollback
 */
app.delete("/api/purge/:purgeJobId/rollback", async (req: Request, res: Response): Promise<void> => {
  const purgeJobId = req.params.purgeJobId as string;
  const job = await prisma.purgeJob.findUnique({
    where: { id: purgeJobId },
    include: { store: true },
  });
  if (!job) { res.status(404).json({ error: "Purge job not found" }); return; }
  if (!job.duplicateThemeId) { res.status(400).json({ error: "No duplicate theme to rollback" }); return; }

  const jobWithStore = job as typeof job & { store: { shopDomain: string; accessToken: string } };
  const client = new ShopifyAdminClient(jobWithStore.store.shopDomain, jobWithStore.store.accessToken);
  const dupeId = Number(job.duplicateThemeId);

  await rollbackPurge(client, dupeId);

  await prisma.purgeJob.update({
    where: { id: job.id },
    data: { status: "rolled_back" },
  });

  res.json({ success: true, message: `Rollback complete — theme ${dupeId} deleted` });
});

// ─────────────────────────────────────────────
// 404 + Error Handlers
// ─────────────────────────────────────────────

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not Found" });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[error]", err.message, err.stack);
  res.status(500).json({
    error: NODE_ENV === "production" ? "Internal Server Error" : err.message,
  });
});

// ─────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[ghost-api] Server running on http://localhost:${PORT} (${NODE_ENV})`);
});

export default app;
