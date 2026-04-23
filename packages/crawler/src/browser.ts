import puppeteer, { type Browser, type Page } from "puppeteer";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface BrowserConfig {
  headless?: boolean;
  executablePath?: string;
  /** Extra Chrome flags to append */
  extraArgs?: string[];
}

export interface PageConfig {
  timeoutMs?: number;
  userAgent?: string;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const CHROME_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--no-first-run",
  "--no-zygote",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-sync",
  "--metrics-recording-only",
  "--mute-audio",
  "--safebrowsing-disable-auto-update",
] as const;

const DEFAULT_USER_AGENT = "GhostCodeBot/1.0";
const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const DEFAULT_TIMEOUT_MS = 30_000;

// ─────────────────────────────────────────────
// Browser lifecycle
// ─────────────────────────────────────────────

/**
 * Launches a headless Chrome instance.
 * Respects PUPPETEER_EXECUTABLE_PATH env var (points to system Chrome).
 */
export async function launchBrowser(config: BrowserConfig = {}): Promise<Browser> {
  const {
    headless = true,
    executablePath = process.env.PUPPETEER_EXECUTABLE_PATH,
    extraArgs = [],
  } = config;

  const browser = await puppeteer.launch({
    headless,
    executablePath,
    args: [...CHROME_ARGS, ...extraArgs],
    defaultViewport: DEFAULT_VIEWPORT,
  });

  return browser;
}

/**
 * Opens a new page in the given browser with a configured user agent and timeout.
 */
export async function newPage(browser: Browser, config: PageConfig = {}): Promise<Page> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, userAgent = DEFAULT_USER_AGENT } = config;

  const page = await browser.newPage();

  await page.setUserAgent(userAgent);
  await page.setViewport(DEFAULT_VIEWPORT);
  page.setDefaultNavigationTimeout(timeoutMs);
  page.setDefaultTimeout(timeoutMs);

  return page;
}

/**
 * Gracefully closes the browser, swallowing any errors on shutdown.
 */
export async function closeBrowser(browser: Browser): Promise<void> {
  try {
    await browser.close();
  } catch {
    // Ignore close errors — process may already be gone
  }
}
