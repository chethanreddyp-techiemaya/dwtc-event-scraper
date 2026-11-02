import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto("https://www.dwtc.com/en/events/", {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });
  await page.waitForTimeout(3000);

  const loadMore = page.getByText(/load more/i).first();

  console.log("LOAD MORE ELEMENT:");
  console.log(await loadMore.evaluate(el => ({
    tag: el.tagName,
    text: el.innerText,
    html: el.outerHTML,
    parentHtml: el.parentElement?.outerHTML.slice(0, 1500),
    rect: (() => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    })()
  })));

  console.log("EVENT LISTING CONTAINERS:");
  console.log(JSON.stringify(
    await page.locator('[class*="ListingEvents"]').evaluateAll(
      els => els.map(el => ({
        tag: el.tagName,
        className: el.className,
        text: (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 500),
        childCount: el.children.length
      })).slice(0, 20)
    ),
    null,
    2
  ));
} finally {
  await browser.close();
}
