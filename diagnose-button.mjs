import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.goto("https://www.dwtc.com/en/events/", {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });
  await page.waitForTimeout(3000);

  console.log("BUTTONS:");
  console.log(JSON.stringify(
    await page.locator("button, [role='button'], input[type='button']").evaluateAll(
      elements => elements.map(el => ({
        tag: el.tagName,
        text: (el.innerText || "").trim(),
        ariaLabel: el.getAttribute("aria-label"),
        disabled: el.disabled ?? false,
        visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
        html: el.outerHTML.slice(0, 500)
      }))
    ),
    null,
    2
  ));

  console.log("LOAD MORE TEXT MATCHES:", await page.getByText(/load more/i).count());
  console.log("PAGE EVENT COUNT TEXT:", (await page.locator("body").innerText()).match(/\(\d+ Events?\)/)?.[0] ?? "not found");
} finally {
  await browser.close();
}
