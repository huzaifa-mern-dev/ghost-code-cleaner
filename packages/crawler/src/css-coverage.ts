import type { Browser, Page } from "puppeteer";
import type { TemplateConfig } from "./url-discovery";
import { loadPageFully } from "./page-loader";
import { newPage } from "./browser";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

/** Raw CDP coverage entry returned by Puppeteer's getCSSCoverage() */
export interface CSSCoverageEntry {
  url: string;
  text: string;
  ranges: Array<{ start: number; end: number }>;
}

/** Per-selector aggregated coverage across all crawled templates */
export interface SelectorCoverage {
  selector: string;
  sourceFile: string;
  usedInTemplates: string[];
  unusedInTemplates: string[];
  coveragePercent: number;
}

// ─────────────────────────────────────────────
// CDP Coverage Control
// ─────────────────────────────────────────────

/**
 * Starts Puppeteer's built-in CSS coverage tracking on the given page.
 * Must be called before navigation.
 */
export async function startCoverage(page: Page): Promise<void> {
  await page.coverage.startCSSCoverage({
    resetOnNavigation: false,
  });
}

/**
 * Stops CSS coverage tracking and returns raw coverage entries.
 * Each entry contains the stylesheet text and the byte ranges that were used.
 */
export async function stopCoverage(page: Page): Promise<CSSCoverageEntry[]> {
  const raw = await page.coverage.stopCSSCoverage();

  return raw.map((entry) => ({
    url: entry.url,
    text: entry.text ?? "",
    ranges: entry.ranges,
  }));
}

// ─────────────────────────────────────────────
// Selector Extraction from Coverage Data
// ─────────────────────────────────────────────

/**
 * Parses raw CDP coverage entries using css-tree to extract per-selector
 * usage. For each selector found in the stylesheet, we check if its character
 * position overlaps with any of the "used" byte ranges reported by CDP.
 *
 * Returns a Map keyed by `sourceFile::selector` for uniqueness.
 */
export async function parseCoverageToSelectors(
  entries: CSSCoverageEntry[]
): Promise<Map<string, { used: boolean; sourceFile: string; selector: string }>> {
  const csstree = await import("css-tree");
  const result = new Map<string, { used: boolean; sourceFile: string; selector: string }>();

  for (const entry of entries) {
    if (!entry.text) continue;

    // Build a fast lookup: is a given character position inside a used range?
    const usedRanges = entry.ranges;
    const isPositionUsed = (pos: number): boolean =>
      usedRanges.some((r) => pos >= r.start && pos <= r.end);

    let ast: ReturnType<typeof csstree.parse>;
    try {
      ast = csstree.parse(entry.text, {
        positions: true,
        parseAtrulePrelude: false,
        parseRulePrelude: true,
        parseValue: false,
      });
    } catch {
      // Malformed CSS — skip this stylesheet
      continue;
    }

    csstree.walk(ast, (node) => {
      if (node.type !== "Rule") return;
      if (node.prelude.type !== "SelectorList") return;

      const loc = node.prelude.loc;
      if (!loc) return;

      // A selector is "used" if its start position falls inside any used range
      const selectorStart = loc.start.offset;
      const used = isPositionUsed(selectorStart);

      let selectorText: string;
      try {
        selectorText = csstree.generate(node.prelude);
      } catch {
        return; // Can't generate selector text — skip
      }

      const key = `${entry.url}::${selectorText}`;
      if (!result.has(key)) {
        result.set(key, { used, sourceFile: entry.url, selector: selectorText });
      } else {
        // If used in ANY template pass, mark as used
        if (used) {
          result.get(key)!.used = true;
        }
      }
    });
  }

  return result;
}

// ─────────────────────────────────────────────
// Full Multi-Template Coverage Map
// ─────────────────────────────────────────────

/**
 * Runs CSS coverage across all templates in the crawl plan.
 * Opens a fresh page for each template, starts coverage, fully loads the page,
 * stops coverage, and aggregates per-selector data across templates.
 *
 * Returns a Map keyed by `sourceFile::selector` with SelectorCoverage objects
 * tracking which templates had the selector used vs unused.
 */
export async function buildFullCoverageMap(
  browser: Browser,
  templates: TemplateConfig[]
): Promise<Map<string, SelectorCoverage>> {
  const coverageMap = new Map<string, SelectorCoverage>();

  for (const template of templates) {
    const page = await newPage(browser);

    try {
      await startCoverage(page);
      await loadPageFully(page, template.url);
      const entries = await stopCoverage(page);
      const selectors = await parseCoverageToSelectors(entries);

      for (const [key, { used, sourceFile, selector }] of selectors) {
        if (!coverageMap.has(key)) {
          coverageMap.set(key, {
            selector,
            sourceFile,
            usedInTemplates: [],
            unusedInTemplates: [],
            coveragePercent: 0,
          });
        }

        const entry = coverageMap.get(key)!;
        if (used) {
          if (!entry.usedInTemplates.includes(template.name)) {
            entry.usedInTemplates.push(template.name);
          }
        } else {
          if (!entry.unusedInTemplates.includes(template.name)) {
            entry.unusedInTemplates.push(template.name);
          }
        }
      }
    } catch (err) {
      // Log but don't abort — one bad template shouldn't kill the audit
      console.warn(`[css-coverage] Failed for template "${template.name}": ${String(err)}`);
    } finally {
      await page.close();
    }
  }

  // Compute final coveragePercent for each selector
  for (const entry of coverageMap.values()) {
    const total = entry.usedInTemplates.length + entry.unusedInTemplates.length;
    entry.coveragePercent = total > 0
      ? (entry.usedInTemplates.length / total) * 100
      : 0;
  }

  return coverageMap;
}
