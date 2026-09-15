import puppeteer, { type Browser, type Page } from "puppeteer";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";

const NOT_FOUND_MARKERS = [
  "This account doesn't exist",
  "doesn't exist",
  "This content isn't available at the moment",
];

/**
 * X / Twitter checker — puppeteer.
 *
 * Request interception ON: abort image/stylesheet/font/media, continue the
 * rest. Fixed 3s sleep after load (spec-preserved). Always closes the browser.
 */
export async function checkForTwitter(
  baseUrl: string,
  username: string
): Promise<boolean> {
  let browser: Browser | undefined;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page: Page = await browser.newPage();

    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const type = request.resourceType();
      if (["image", "stylesheet", "font", "media"].includes(type)) {
        request.abort();
      } else {
        request.continue();
      }
    });

    await page.goto(`${baseUrl}/${username}`, {
      waitUntil: "domcontentloaded",
      timeout: 10000,
    });

    // Fixed 3s sleep after load.
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const bodyText = await page.evaluate(() => {
      const doc: any = (globalThis as any).document;
      return doc?.body?.innerText ?? "";
    });
    const notFound = NOT_FOUND_MARKERS.some((marker) =>
      bodyText.includes(marker)
    );
    return !notFound;
  } catch {
    return false;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
