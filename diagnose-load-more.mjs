
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 }
  });

  await page.goto("https://www.dwtc.com/en/events/", {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(5000);

  async function getEventUrls() {
    return await page.locator("a[href]").evaluateAll(anchors => {
      return [...new Set(
        anchors
          .map(a => {
            try {
              const url = new URL(a.href);

              if (
                url.hostname === "www.dwtc.com" &&
                /^\/en\/events\/[^/]+\/?$/.test(url.pathname)
              ) {
                return url.href;
              }
            } catch {}

            return null;
          })
          .filter(Boolean)
      )];
    });
  }

  for (let i = 0; i < 10; i++) {
    const beforeUrls = await getEventUrls();

    console.log(`Before click ${i + 1}: ${beforeUrls.length}`);

    const button = page.getByRole("button", {
      name: /^load more$/i
    });

    if (!(await button.count())) {
      console.log("Load More button not found.");
      break;
    }

    await button.scrollIntoViewIfNeeded();

    if (!(await button.isVisible())) {
      console.log("Load More button is not visible.");
      break;
    }

    await button.click();
    await page.waitForTimeout(2500);

    const afterUrls = await getEventUrls();

    console.log(`After click ${i + 1}: ${afterUrls.length}`);

    if (afterUrls.length <= beforeUrls.length) {
      console.log("No new event links detected; stopping.");
      break;
    }
  }

  const finalUrls = await getEventUrls();

  console.log("\nFINAL UNIQUE DWTC EVENT COUNT:", finalUrls.length);
  console.log(finalUrls.join("\n"));
} finally {
  await browser.close();
}
