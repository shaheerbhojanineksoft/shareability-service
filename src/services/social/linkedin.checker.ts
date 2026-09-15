import { Cluster } from "puppeteer-cluster";
import puppeteerExtra from "puppeteer-extra";

/**
 * LinkedIn checker — puppeteer-cluster + puppeteer-extra.
 *
 * Cluster: CONCURRENCY_CONTEXT, maxConcurrency 1, headless,
 * args ['--no-sandbox', '--disable-setuid-sandbox'].
 * Returns `result?.success || false`; cluster outer error → literal `false`.
 */
export async function checkLinkedInUser(
  baseUrl: string,
  username: string
): Promise<boolean> {
  const profileUrl = `${baseUrl}/${username}`;
  let cluster: any = null;
  try {
    cluster = await Cluster.launch({
      concurrency: Cluster.CONCURRENCY_CONTEXT,
      maxConcurrency: 1,
      puppeteer: puppeteerExtra as any,
      puppeteerOptions: {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      } as any,
    });

    const result: any = await cluster.execute(
      profileUrl,
      async ({ page }: any) => {
        await page.goto(profileUrl, { waitUntil: "networkidle0" });

        const redirectedUrl = page.url();
        if (
          redirectedUrl.includes("/checkpoint/") ||
          redirectedUrl.includes("/login")
        ) {
          return { success: false, error: "Login required" };
        }

        const html = await page.content();
        if (html.includes("This page doesn't exist")) {
          return { success: false, error: "Profile does not exist" };
        }

        await page.waitForSelector("h1", { timeout: 5000 });
        const name = await page.$eval(
          "h1",
          (el: any) => el?.textContent?.trim() ?? ""
        );

        return { success: true, name, profileUrl };
      }
    );

    return result?.success || false;
  } catch {
    // cluster outer error → literal false
    return false;
  } finally {
    if (cluster) {
      await cluster.close().catch(() => {});
    }
  }
}
