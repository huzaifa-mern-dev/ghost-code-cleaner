import type { Page } from "puppeteer";

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const SCROLL_INCREMENT_PX = 300;
const SCROLL_DELAY_MS = 80;
const POST_SCROLL_SETTLE_MS = 1_500;
const PAGE_LOAD_TIMEOUT_MS = 45_000;

const INTERACTIVE_SELECTORS = [
  "[data-toggle]",
  "[aria-expanded]",
  ".accordion",
  ".accordion__button",
  ".tab",
  ".tab-button",
  "[role='tab']",
  "details",
  "details > summary",
] as const;

// ─────────────────────────────────────────────
// Page Loading
// ─────────────────────────────────────────────

/**
 * Fully loads a page by navigating to the URL and simulating a human scroll
 * to trigger lazy-loaded assets and deferred JS.
 *
 * Strategy:
 *   1. Try networkidle2 (most accurate, but slow on heavy pages)
 *   2. Fall back to domcontentloaded + 3s settle if networkidle2 times out
 */
export async function loadPageFully(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: PAGE_LOAD_TIMEOUT_MS,
    });
  } catch {
    // networkidle2 timed out — the page loaded but has persistent connections
    // (WebSockets, analytics beacons, etc.). Proceed with what we have.
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: PAGE_LOAD_TIMEOUT_MS,
      });
      await sleep(3_000); // let JS-injected assets settle
    } catch {
      // Page completely unreachable — let caller handle
      throw new Error(`Failed to load page: ${url}`);
    }
  }

  // Scroll the full document height in increments to trigger lazy loads
  await scrollFullPage(page);

  // Let deferred/lazy JS settle after scroll
  await sleep(POST_SCROLL_SETTLE_MS);
}

/**
 * Scrolls from top to bottom of the page in 300px increments, pausing 80ms
 * between each step to replicate a natural reading/browsing pace.
 */
async function scrollFullPage(page: Page): Promise<void> {
  try {
    await page.evaluate(
      async (increment: number, delay: number) => {
        await new Promise<void>((resolve) => {
          const scrollHeight = document.documentElement.scrollHeight;
          let currentY = 0;

          const step = () => {
            currentY = Math.min(currentY + increment, scrollHeight);
            window.scrollTo(0, currentY);

            if (currentY < scrollHeight) {
              setTimeout(step, delay);
            } else {
              resolve();
            }
          };

          step();
        });
      },
      SCROLL_INCREMENT_PX,
      SCROLL_DELAY_MS
    );
  } catch {
    // Scroll failed (page may have navigated) — not fatal
  }
}

// ─────────────────────────────────────────────
// Interaction Simulation
// ─────────────────────────────────────────────

/**
 * Clicks interactive elements like accordions, tabs, and details elements
 * to expand them and trigger any associated JS/CSS loading.
 * Errors are swallowed — not all elements may be clickable in all contexts.
 */
export async function simulateInteractions(page: Page): Promise<void> {
  for (const selector of INTERACTIVE_SELECTORS) {
    try {
      const elements = await page.$$(selector);
      for (const el of elements.slice(0, 3)) {
        try {
          await el.click({ delay: 50 });
          await sleep(200);
        } catch {
          // Element not clickable, detached, or hidden — skip silently
        }
      }
    } catch {
      // Selector threw, not found, or page navigated — skip silently
    }
  }
}

// ─────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
