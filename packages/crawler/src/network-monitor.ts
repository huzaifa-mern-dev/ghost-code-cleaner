import type { Page, HTTPResponse } from "puppeteer";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface NetworkRequest {
  url: string;
  resourceType: string;
  status: number;
  size: number;
  timing: number; // response time in ms
}

// ─────────────────────────────────────────────
// Known tracking/analytics domains
// ─────────────────────────────────────────────

const TRACKING_DOMAINS = [
  "google-analytics.com",
  "googletagmanager.com",
  "facebook.com",
  "facebook.net",
  "doubleclick.net",
  "hotjar.com",
  "segment.com",
  "mixpanel.com",
  "amplitude.com",
  "klaviyo.com",
  "analytics.tiktok.com",
  "snap.licdn.com",
  "ads.twitter.com",
  "connect.facebook.net",
] as const;

// Resource types we care about for orphan detection
const TRACKED_RESOURCE_TYPES = new Set([
  "script",
  "stylesheet",
  "fetch",
  "xhr",
  "image",
]);

// ─────────────────────────────────────────────
// Network Capture
// ─────────────────────────────────────────────

/**
 * Navigates to a URL while recording all network responses.
 * Attaches the response listener BEFORE navigation so nothing is missed.
 * Captures: script, stylesheet, fetch, xhr, image resource types.
 */
export async function captureNetworkRequests(
  page: Page,
  url: string
): Promise<NetworkRequest[]> {
  const requests: NetworkRequest[] = [];

  const requestTimings = new Map<string, number>();

  page.on("request", (req) => {
    requestTimings.set(req.url(), Date.now());
  });

  // Must attach listener before navigation
  const handleResponse = async (response: HTTPResponse) => {
    const req = response.request();
    const resourceType = req.resourceType();

    if (!TRACKED_RESOURCE_TYPES.has(resourceType)) return;

    const requestedAt = requestTimings.get(response.url()) ?? Date.now();
    const timing = Date.now() - requestedAt;

    let size = 0;
    try {
      const buffer = await response.buffer();
      size = buffer.length;
    } catch {
      const contentLength = response.headers()["content-length"];
      size = contentLength ? parseInt(contentLength, 10) : 0;
    }

    requests.push({
      url: response.url(),
      resourceType,
      status: response.status(),
      size,
      timing,
    });
  };

  page.on("response", handleResponse);

  try {
    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 45_000 });
    } catch {
      // Fallback: domcontentloaded + settle for pages with persistent connections
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await new Promise((r) => setTimeout(r, 3_000));
    }
  } finally {
    page.off("response", handleResponse);
  }

  return requests;
}

// ─────────────────────────────────────────────
// Analysis Helpers
// ─────────────────────────────────────────────

/**
 * Returns all script/stylesheet requests that returned a 404.
 * These are strong signals for orphaned app assets that no longer exist.
 */
export function find404Scripts(requests: NetworkRequest[]): NetworkRequest[] {
  return requests.filter(
    (r) =>
      r.status === 404 &&
      (r.resourceType === "script" || r.resourceType === "stylesheet")
  );
}

/**
 * Returns image requests to known analytics/tracking pixel domains.
 * Useful for identifying invisible tracking beacons loaded by uninstalled apps.
 */
export function detectTrackingPixels(requests: NetworkRequest[]): NetworkRequest[] {
  return requests.filter((r) => {
    if (r.resourceType !== "image") return false;
    try {
      const hostname = new URL(r.url).hostname;
      return TRACKING_DOMAINS.some((domain) => hostname.includes(domain));
    } catch {
      return false;
    }
  });
}
