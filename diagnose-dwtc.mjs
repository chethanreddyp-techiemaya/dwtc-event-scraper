import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();

  await page.goto("https://www.dwtc.com/en/events/", {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(5000);

  console.log("TITLE:", await page.title());

  const links = await page.locator('a[href*="/en/events/"]').evaluateAll(
    anchors => [...new Map(
      anchors.map(a => [
        a.href,
        {
          text: (a.innerText || "").trim().replace(/\s+/g, " ").slice(0, 100),
          href: a.href
        }
      ])
    ).values()].slice(0, 60)
  );

  console.log("EVENT LINKS:");
  console.log(JSON.stringify(links, null, 2));

  console.log("BODY TEXT:");
  console.log((await page.locator("body").innerText()).slice(0, 6000));
} finally {
  await browser.close();
}
