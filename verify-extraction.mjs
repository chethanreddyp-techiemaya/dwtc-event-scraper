/**
 * Targeted verification script: scrapes specific external event websites,
 * visits their sub-pages, and prints structured extraction results.
 * Run: node verify-extraction.mjs
 */

import { chromium } from 'playwright';
import { parseExternalPeople, discoverExternalSubpages } from './dwtc-parser.mjs';

const TARGETS = [
  // Has an explicit sponsors page and organiser info
  { name: 'Beautyworld Dubai', url: 'https://beautyworld-dubai.ae.messefrankfurt.com/dubai/en.html' },
  // Has speakers listed on website
  { name: 'GOTECH 2026', url: 'https://www.spe-events.org/gotech' },
  // The Airport Show has about/organiser/sponsor info
  { name: 'The Airport Show', url: 'https://www.theairportshow.com/' },
  // Concept Brands
  { name: 'Concept Brands', url: 'https://www.conceptbrands.net/' },
];

// Simulate a timeout scenario with an unreachable URL
const TIMEOUT_TARGET = {
  name: 'Timeout Test (unreachable)',
  url: 'https://192.0.2.1/',  // RFC 5737 TEST-NET, guaranteed unreachable
};

async function scrapeTarget(context, target, timeoutMs = 15000) {
  const page = await context.newPage();
  const result = { speakers: [], exhibitors: [], sponsors: [], host: [], subpagesVisited: [] };

  try {
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: 7000 }).catch(() => {});
    const homeHtml = await page.content();

    result.homepageData = parseExternalPeople(homeHtml);
    Object.assign(result, result.homepageData);

    const subpageUrls = discoverExternalSubpages(homeHtml, target.url);
    result.subpagesDiscovered = subpageUrls;

    const MAX_SUBPAGES = 5;
    for (let i = 0; i < Math.min(subpageUrls.length, MAX_SUBPAGES); i++) {
      if (result.speakers.length && result.exhibitors.length && result.sponsors.length && result.host.length) break;
      const subPage = await context.newPage();
      try {
        await subPage.goto(subpageUrls[i], { waitUntil: 'domcontentloaded', timeout: 12000 });
        await subPage.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        const subPeople = parseExternalPeople(await subPage.content());
        result.subpagesVisited.push({ url: subpageUrls[i], extracted: subPeople });
        for (const field of ['speakers', 'exhibitors', 'sponsors', 'host']) {
          if (!result[field].length && subPeople[field].length) {
            result[field] = subPeople[field];
          }
        }
      } catch (e) {
        result.subpagesVisited.push({ url: subpageUrls[i], error: e.message });
      } finally {
        await subPage.close().catch(() => {});
      }
    }

    result.status = 'OK';
  } catch (e) {
    result.status = 'FAILED';
    result.error = e.message;
  } finally {
    await page.close().catch(() => {});
  }

  return result;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'en-US' });

console.log('='.repeat(80));
console.log('EXTERNAL EXTRACTION VERIFICATION');
console.log('='.repeat(80));

// ── Timeout test ────────────────────────────────────────────────────────────
console.log(`\n[TIMEOUT TEST] ${TIMEOUT_TARGET.name} (${TIMEOUT_TARGET.url})`);
let remainingWorks = true;
try {
  const t = await scrapeTarget(context, TIMEOUT_TARGET, 5000);
  if (t.status === 'FAILED') {
    console.log('  ✓ Timeout handled gracefully — error:', t.error.slice(0, 120));
    console.log('  ✓ Script continued executing after timeout');
  }
} catch (e) {
  console.log('  ✗ Unexpected uncaught error:', e.message);
  remainingWorks = false;
}

// ── Main targets ─────────────────────────────────────────────────────────────
for (const target of TARGETS) {
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`[EVENT] ${target.name}`);
  console.log(`[URL]   ${target.url}`);

  const r = await scrapeTarget(context, target);

  console.log(`[STATUS] ${r.status}${r.error ? ' — ' + r.error.slice(0, 100) : ''}`);
  console.log(`[SUBPAGES DISCOVERED] (${r.subpagesDiscovered?.length ?? 0})`);
  if (r.subpagesDiscovered?.length) {
    r.subpagesDiscovered.forEach(u => console.log(`  - ${u}`));
  }
  console.log(`[SUBPAGES VISITED] (${r.subpagesVisited?.length ?? 0})`);
  r.subpagesVisited?.forEach(sp => {
    const fields = sp.extracted
      ? Object.entries(sp.extracted).map(([k, v]) => `${k}:${v.length}`).join(' ')
      : `ERROR: ${sp.error?.slice(0, 80)}`;
    console.log(`  - ${sp.url} → ${fields}`);
  });

  console.log(`\n[HOSTS]     (${r.host.length})`);
  r.host.slice(0, 10).forEach(h => console.log(`  ${h}`));

  console.log(`[SPONSORS]  (${r.sponsors.length})`);
  r.sponsors.slice(0, 20).forEach(s => console.log(`  ${s}`));

  console.log(`[SPEAKERS]  (${r.speakers.length})`);
  r.speakers.slice(0, 10).forEach(s => console.log(`  ${s}`));

  console.log(`[EXHIBITORS] (${r.exhibitors.length})`);
  r.exhibitors.slice(0, 10).forEach(e => console.log(`  ${e}`));
}

await context.close();
await browser.close();

console.log('\n' + '='.repeat(80));
console.log('VERIFICATION COMPLETE');
console.log('='.repeat(80));

