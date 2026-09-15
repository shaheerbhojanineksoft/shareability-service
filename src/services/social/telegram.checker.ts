import puppeteer, { type Browser } from "puppeteer";

const INVALID_MARKERS = [
  "If you have Telegram, you can contact",
  "such user doesn't exist",
];

/**
 * Telegram checker — puppeteer.
 *
 * If the current URL includes telegram.org → false (login redirect). Always
 * closes the browser.
 */
export async function checkTelegramUser(
  baseUrl: string,
  username: string
): Promise<boolean> {
  let browser: Browser | undefined;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage();

    await page.goto(`${baseUrl}/${username}`, {
      waitUntil: "domcontentloaded",
      timeout: 10000,
    });

    // Login redirect to telegram.org → invalid.
    if (page.url().includes("telegram.org")) {
      return false;
    }

    const bodyText = await page.evaluate(() => {
      const doc: any = (globalThis as any).document;
      return doc?.body?.innerText ?? "";
    });
    const isInvalid = INVALID_MARKERS.some((marker) =>
      bodyText.includes(marker)
    );
    return !isInvalid;
  } catch {
    return false;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
