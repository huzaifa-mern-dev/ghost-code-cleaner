#!/usr/bin/env node
import { Command } from "commander";
import { runFullAudit } from "./audit-runner";

// ─────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────

const program = new Command();

program
  .name("ghost-code")
  .description("Ghost Code Cleaner — detect orphaned CSS/JS in Shopify stores")
  .version("0.1.0");

program
  .command("audit <storeUrl>")
  .description("Run a full orphaned code audit against a Shopify store")
  .option("-o, --output <path>", "Write JSON report to file path")
  .option(
    "-t, --templates <list>",
    "Comma-separated template names to crawl (e.g. home,product,cart)",
    ""
  )
  .option("--headless <bool>", "Run Chrome in headless mode (default: true)", "true")
  .action(async (storeUrl: string, opts: { output?: string; templates?: string; headless?: string }) => {
    const headless = opts.headless !== "false";
    const templates =
      opts.templates && opts.templates.length > 0
        ? opts.templates.split(",").map((t) => t.trim()).filter(Boolean)
        : undefined;

    console.log(`\n🔍 Starting audit for: ${storeUrl}`);
    if (templates) {
      console.log(`   Templates: ${templates.join(", ")}`);
    }
    if (!headless) {
      console.log("   Mode: headed (debug)");
    }
    console.log("");

    const startMs = Date.now();

    try {
      const report = await runFullAudit(storeUrl, undefined, {
        outputPath: opts.output,
        templates,
        headless,
        onProgress: (templateName) => {
          process.stdout.write(`📄 Crawling template: ${templateName}\n`);
        },
      });

      const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
      const { summary } = report;

      console.log(`\n✅ Audit complete in ${elapsed}s`);
      console.log(`   Findings  : ${summary.totalFindingsCount} orphaned selectors`);
      console.log(`   High      : ${summary.highConfidenceCount}`);
      console.log(`   Medium    : ${summary.mediumConfidenceCount}`);
      console.log(`   Low       : ${summary.lowConfidenceCount}`);
      console.log(`   Savings   : ${summary.totalPayloadSavingsKB} KB`);
      console.log(`   LCP gain  : ~${summary.estimatedLCPImprovementMs}ms`);
      console.log(`   TBT gain  : ~${summary.estimatedTBTImprovementMs}ms`);
      console.log(`   Templates : ${summary.templatesAudited} crawled`);
      console.log(`   404 assets: ${report.networkIssues.notFound404.length} broken references`);

      if (opts.output) {
        console.log(`\n💾 Report saved to: ${opts.output}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n❌ Audit failed: ${msg}`);
      if (process.env.NODE_ENV !== "production") {
        console.error(err);
      }
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────
// Parse & Execute
// ─────────────────────────────────────────────

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});
