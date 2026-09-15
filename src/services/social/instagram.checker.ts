import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

import { constants } from "../../config/constants";

// Enable the stealth plugin once at module load (mirrors webapi setup).
puppeteerExtra.use(StealthPlugin());

const NOT_FOUND_MARKERS = [
  "This page isn't available",
  "Sorry, this page isn't available",
  "Page Not Found",
];

/**
 * Instagram checker — puppeteer-extra + stealth plugin (real login flow).
 *
 * Heaviest / most fragile checker: real login with 60s login timeout. Always
 * closes the browser.
 */
export async function checkInstagramUsername(
  baseUrl: string,
  username: string
): Promise<boolean> {
  let browser: any;
  try {
    browser = await puppeteerExtra.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
    const page = await browser.newPage();
    await page.setUserAgent("Instagram 277.0.0.27.111 Android");

    await page.goto("https://www.instagram.com/accounts/login", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    await page.type('input[name="username"]', constants.INSTAGRAM_USERNAME, {
      delay: 50,
    });
    await page.type('input[name="password"]', constants.INSTAGRAM_PASSWORD, {
      delay: 50,
    });

    // Login click: prefer the aria-label "Log in" button, else the submit one.
    let loginButton: any = await page.$(
      'div[role="button"][aria-label="Log in"]'
    );
    if (!loginButton) {
      try {
        loginButton = await page.$('button[type="submit"]');
      } catch {
        // Nested catch — already logged in when /login is gone from the URL.
        if (!page.url().includes("/login")) {
          return false;
        }
        loginButton = await page.$('button[type="submit"]');
      }
    }
    if (!loginButton) {
      return false;
    }

    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2" }),
      loginButton.click(),
    ]);

    await page.goto(`${baseUrl}/${username}`, {
      waitUntil: "networkidle0",
      timeout: 15000,
    });

    // Valid when the page title contains the username.
    const title = await page.title();
    if (title.includes(username)) {
      return true;
    }

    const bodyText = await page.evaluate(() => {
      const doc: any = (globalThis as any).document;
      return doc?.body?.innerText ?? "";
    });
    const isInvalid = NOT_FOUND_MARKERS.some((marker) =>
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
