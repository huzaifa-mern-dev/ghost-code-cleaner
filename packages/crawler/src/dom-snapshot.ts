import type { Page } from "puppeteer";
import { loadPageFully } from "./page-loader";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface DOMElement {
  tag: string;
  id: string;
  classes: string[];
  dataAttributes: Record<string, string>;
  hasInlineHandlers: boolean;
}

export interface DOMSnapshot {
  template: string;
  url: string;
  elements: DOMElement[];
  allClassNames: Set<string>;
  allIds: Set<string>;
  capturedAt: Date;
}

// Serialisable version for JSON output (Sets → arrays)
export interface DOMSnapshotJSON {
  template: string;
  url: string;
  elements: DOMElement[];
  allClassNames: string[];
  allIds: string[];
  capturedAt: string;
}

// ─────────────────────────────────────────────
// DOM Snapshot Capture
// ─────────────────────────────────────────────

/**
 * Captures a full DOM snapshot of a page.
 * Navigates to the URL, fully loads the page including lazy assets,
 * then extracts all DOM element metadata via page.evaluate().
 */
export async function captureDOMSnapshot(
  page: Page,
  templateName: string,
  url: string
): Promise<DOMSnapshot> {
  await loadPageFully(page, url);

  const rawElements = await page.evaluate(() => {
    const INLINE_HANDLERS = ["onclick", "onchange", "onsubmit", "onload", "onerror"];

    return Array.from(document.querySelectorAll("*")).map((el) => {
      // Collect data-* attributes
      const dataAttributes: Record<string, string> = {};
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.startsWith("data-")) {
          dataAttributes[attr.name] = attr.value;
        }
      }

      // Check for inline event handlers
      const hasInlineHandlers = INLINE_HANDLERS.some((h) =>
        el.hasAttribute(h)
      );

      return {
        tag: el.tagName.toLowerCase(),
        id: el.id ?? "",
        classes: Array.from(el.classList),
        dataAttributes,
        hasInlineHandlers,
      };
    });
  });

  // Build aggregate sets for fast class/id lookup during analysis
  const allClassNames = new Set<string>();
  const allIds = new Set<string>();

  for (const el of rawElements) {
    for (const cls of el.classes) {
      if (cls) allClassNames.add(cls);
    }
    if (el.id) allIds.add(el.id);
  }

  return {
    template: templateName,
    url,
    elements: rawElements,
    allClassNames,
    allIds,
    capturedAt: new Date(),
  };
}

/**
 * Serialises a DOMSnapshot to a plain JSON-safe object (Set → Array).
 */
export function snapshotToJSON(snapshot: DOMSnapshot): DOMSnapshotJSON {
  return {
    template: snapshot.template,
    url: snapshot.url,
    elements: snapshot.elements,
    allClassNames: [...snapshot.allClassNames],
    allIds: [...snapshot.allIds],
    capturedAt: snapshot.capturedAt.toISOString(),
  };
}
