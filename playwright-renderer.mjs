import { chromium } from 'playwright';
import {
  monthNames,
  normalize,
  overlapsMonth,
  parseEventPage,
  parseExternalPeople,
  discoverExternalSubpages,
} from './dwtc-parser.mjs';

function safeExternal(raw, base) {
  try {
    const url = new URL(raw);
    const baseUrl = new URL(base);

    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      return false;
    }

    if (
      url.hostname === 'localhost' ||
      url.hostname.endsWith('.local') ||
      url.hostname === baseUrl.hostname
    ) {
      return false;
    }

    if (
      /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
        url.hostname
      )
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function normalizeDwtcEventUrl(raw, base) {
  try {
    const url = new URL(raw, base);
    const baseUrl = new URL(base);

    if (url.hostname !== 'www.dwtc.com') return null;
    if (url.origin !== baseUrl.origin) return null;
    if (!/^\/en\/events\/[^/]+\/?$/.test(url.pathname)) return null;

    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function getMonthIndex(text) {
  const normalized = normalize(text).toLowerCase();

  return monthNames.findIndex((name) =>
    normalized.includes(name.toLowerCase())
  );
}

function getDisplayedMonthYear(bodyText) {
  const monthPattern =
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i;

  const match = bodyText.match(monthPattern);

  if (!match) return null;

  const monthIndex = getMonthIndex(match[1]);

  if (monthIndex < 0) return null;

  return {
    month: monthIndex + 1,
    year: Number(match[2]),
    label: `${monthNames[monthIndex]} ${match[2]}`,
  };
}

function getMonthCalendarIndex(year, month) {
  return year * 12 + month - 1;
}

function monthDifference(current, target) {
  return (
    getMonthCalendarIndex(target.year, target.month) -
    getMonthCalendarIndex(current.year, current.month)
  );
}

export function createRenderer(config, logger = console) {
  let browserPromise;

  const getBrowser = async () => {
    if (browserPromise) {
      try {
        const b = await browserPromise;
        if (b && b.isConnected()) {
          return b;
        }
      } catch {
        browserPromise = null;
      }
    }

    browserPromise = chromium.launch({
      headless: config.headless,
    });
    return browserPromise;
  };

  async function scrape({
    year,
    month,
    onProgress = () => {},
    onEvent = () => {},
    signal,
  }) {
    if (signal?.aborted) {
      throw signal.reason || new Error('Scrape job aborted.');
    }

    const b = await getBrowser();
    const context = await b.newContext({ locale: 'en-US' });
    const listing = await context.newPage();

    listing.setDefaultNavigationTimeout(config.navTimeoutMs);

    const abortHandler = () => {
      listing?.close().catch(() => {});
      context?.close().catch(() => {});
    };
    signal?.addEventListener('abort', abortHandler, { once: true });

    const failures = [];
    const candidates = new Map();

    try {
      onProgress({
        phase: 'opening',
        message: 'Opening DWTC events listing...',
        done: 0,
        total: 0,
      });

      let loaded = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await listing.goto(config.eventsUrl, {
            waitUntil: 'domcontentloaded',
          });
          loaded = true;
          break;
        } catch (err) {
          if (attempt === 2) throw err;
          logger.warn?.(
            `Initial DWTC page load attempt ${attempt + 1} failed, retrying...`,
            { error: err.message }
          );
          await listing.waitForTimeout(2000);
        }
      }

      await listing.waitForLoadState('networkidle', {
        timeout: 10000,
      }).catch(() => {});

      await listing.waitForTimeout(2000);

      const target = {
        year,
        month,
        label: `${monthNames[month - 1]} ${year}`,
      };

      console.log(`\nRequested DWTC month: ${target.label}`);
      console.log(`DWTC listing URL: ${listing.url()}`);

      onProgress({
        phase: 'detecting',
        message: 'Detecting displayed month...',
        done: 0,
        total: 0,
      });

      async function readDisplayedMonth() {
        const headingLocator = listing
          .locator(
            'h2[class*="ListingEventsstyled__Title"], [class*="ListingEventsstyled__TitleContainer"] h2, h2'
          )
          .first();

        const headingText = await headingLocator.innerText().catch(() => '');
        const headingMatch = getDisplayedMonthYear(headingText);
        if (headingMatch) {
          return headingMatch;
        }

        const bodyText = await listing
          .locator('body')
          .innerText()
          .catch(() => '');

        return getDisplayedMonthYear(bodyText);
      }

      async function clickMonthDirection(direction, currentMonthInfo) {
        const targetAbbr = currentMonthInfo
          ? (
              direction === 'next'
                ? monthNames[currentMonthInfo.month % 12]
                : monthNames[(currentMonthInfo.month - 2 + 12) % 12]
            ).slice(0, 3).toLowerCase()
          : null;

        const navButtons = listing.locator(
          'button[class*="NavigateBtn"], [class*="ListingEventsstyled__TitleContainer"] button'
        );

        const navCount = await navButtons.count().catch(() => 0);

        if (navCount > 0) {
          if (targetAbbr) {
            for (let i = 0; i < navCount; i++) {
              const btn = navButtons.nth(i);
              if (!(await btn.isVisible().catch(() => false))) continue;

              const text = (await btn.innerText().catch(() => ''))
                .trim()
                .toLowerCase();

              if (text === targetAbbr || text.includes(targetAbbr)) {
                await btn.click({ timeout: 5000 });
                return true;
              }
            }
          }

          if (navCount === 2) {
            const btn = navButtons.nth(direction === 'next' ? 1 : 0);
            if (await btn.isVisible().catch(() => false)) {
              await btn.click({ timeout: 5000 });
              return true;
            }
          }
        }

        if (targetAbbr) {
          const nonCarouselButtons = listing.locator(
            'button:not([class*="slick-"]):not([data-role="none"])'
          );
          const bCount = await nonCarouselButtons.count().catch(() => 0);

          for (let i = 0; i < bCount; i++) {
            const btn = nonCarouselButtons.nth(i);
            if (!(await btn.isVisible().catch(() => false))) continue;

            const text = (await btn.innerText().catch(() => ''))
              .trim()
              .toLowerCase();

            if (text === targetAbbr) {
              await btn.click({ timeout: 5000 });
              return true;
            }
          }
        }

        const controls = listing.locator(
          'button:not([class*="slick-"]):not([data-role="none"]), [role="button"]:not([class*="slick-"]):not([data-role="none"])'
        );

        const count = await controls.count().catch(() => 0);

        for (let i = 0; i < count; i++) {
          const control = controls.nth(i);

          if (!(await control.isVisible().catch(() => false))) {
            continue;
          }

          const attributes = normalize(
            `${await control.getAttribute('aria-label').catch(() => '')} ${
              await control.getAttribute('title').catch(() => '')
            } ${
              await control.getAttribute('class').catch(() => '')
            }`
          ).toLowerCase();

          const isDirection =
            direction === 'next'
              ? /next|forward|right/.test(attributes)
              : /previous|prev|back|left/.test(attributes);

          if (!isDirection) continue;

          try {
            await control.click({ timeout: 5000 });
            return true;
          } catch (error) {
            logger.warn?.('Could not click fallback month control', {
              direction,
              attributes,
              error: error.message,
            });
          }
        }

        return false;
      }
            const maxNavigationSteps = 24;
      let current = await readDisplayedMonth();

      console.log(
        `DWTC initial displayed month: ${current?.label ?? 'Not detected'}`
      );

      if (!current) {
        throw new Error(
          'Could not identify the displayed month/year on the DWTC events page.'
        );
      }

      for (let step = 0; step < maxNavigationSteps; step++) {
        if (
          current.year === target.year &&
          current.month === target.month
        ) {
          console.log(`Confirmed requested DWTC month reached: ${current.label}`);
          break;
        }

        const difference = monthDifference(current, target);
        const direction = difference > 0 ? 'next' : 'previous';

        onProgress({
          phase: 'navigating',
          message: `Navigating to ${target.label} (currently ${current.label})...`,
          done: step,
          total: Math.abs(difference),
        });

        console.log(
          `Navigating ${direction} from ${current.label} towards ${target.label} (difference: ${difference} month(s))`
        );

        const oldLabel = current.label;
        let updated = null;
        const maxClickAttempts = 3;

        for (
          let clickAttempt = 0;
          clickAttempt < maxClickAttempts;
          clickAttempt++
        ) {
          if (signal?.aborted) break;

          const clicked = await clickMonthDirection(direction, current);

          if (!clicked) {
            throw new Error(
              `Could not find a usable ${direction} month control to navigate from ${current.label} to ${target.label}.`
            );
          }

          try {
            await listing.waitForFunction(
              (old) => {
                const heading = document.querySelector(
                  'h2[class*="ListingEventsstyled__Title"], [class*="ListingEventsstyled__TitleContainer"] h2, h2'
                );

                if (!heading) return false;

                const text = (heading.innerText || '').trim();
                return text.length > 0 && !text.includes(old);
              },
              oldLabel,
              { timeout: 3500 }
            );
          } catch {
            // Check the displayed month directly below.
          }

          await listing.waitForTimeout(500);

          const checked = await readDisplayedMonth();

          if (
            checked &&
            (checked.year !== current.year || checked.month !== current.month)
          ) {
            updated = checked;
            break;
          }

          logger.warn?.(
            `Month did not change after click attempt ${clickAttempt + 1}, retrying click...`,
            {
              direction,
              current: current.label,
            }
          );

          await listing.waitForTimeout(1000);
        }

        console.log(
          `DWTC displayed month after navigation step: ${
            updated?.label ?? 'Not detected'
          }`
        );

        if (!updated) {
          throw new Error(
            `Month navigation failed: page remained on ${current.label} after ${maxClickAttempts} click attempts on ${direction} control.`
          );
        }

        current = updated;
      }

      if (
        current.year !== target.year ||
        current.month !== target.month
      ) {
        throw new Error(
          `The DWTC listing did not reach the requested month ${target.label}. Currently on ${current.label}.`
        );
      }

      console.log(`Confirmed DWTC displayed month: ${current.label}`);

      onProgress({
        phase: 'discovering',
        message: `Discovering events for ${target.label}...`,
        done: 0,
        total: 0,
      });

      const headingEl = listing
        .locator(
          'h2[class*="ListingEventsstyled__Title"], [class*="ListingEventsstyled__TitleContainer"] h2, h2'
        )
        .first();

      await headingEl.scrollIntoViewIfNeeded().catch(() => {});

      try {
        await listing.waitForFunction(
          () => {
            const hasLinks = [
              ...document.querySelectorAll('a[href]'),
            ].some((a) => {
              try {
                const u = new URL(a.href);

                return (
                  u.hostname === 'www.dwtc.com' &&
                  /^\/en\/events\/[^/]+\/?$/.test(u.pathname)
                );
              } catch {
                return false;
              }
            });

            if (hasLinks) return true;

            const countMatch = document.body.innerText.match(
              /\((\d+)\s+Events?\)/i
            );

            if (countMatch && parseInt(countMatch[1], 10) > 0) {
              return true;
            }

            return false;
          },
          { timeout: 15000 }
        );
      } catch {
        // The requested month may genuinely contain no events.
      }

      await listing.waitForTimeout(1000);

      const collectEventLinks = async () => {
        const urls = await listing
          .locator('a[href]')
          .evaluateAll((anchors) =>
            anchors.map((anchor) => anchor.href)
          );

        for (const raw of urls) {
          const url = normalizeDwtcEventUrl(raw, config.eventsUrl);

          if (url) {
            candidates.set(url, true);
          }
        }
      };

      await collectEventLinks();

      console.log(
        `DWTC event links discovered initially: ${candidates.size}`
      );

      const maxLoadMoreClicks = 30;

      for (
        let attempt = 0;
        attempt < maxLoadMoreClicks;
        attempt++
      ) {
        if (candidates.size >= config.maxEventsPerJob) {
          break;
        }

        const loadMore = listing
          .getByRole('button', { name: /^load more$/i })
          .first();

        if (!(await loadMore.count().catch(() => 0))) {
          break;
        }

        await loadMore.scrollIntoViewIfNeeded();

        if (!(await loadMore.isVisible().catch(() => false))) {
          break;
        }

        if (!(await loadMore.isEnabled().catch(() => false))) {
          break;
        }

        const previousCount = candidates.size;

        await loadMore.click({ timeout: 5000 }).catch((error) => {
          logger.warn?.('Could not click DWTC Load More button', {
            attempt: attempt + 1,
            error: error.message,
          });
        });

        try {
          await listing.waitForFunction(
            (previousCount) => {
              const urls = [
                ...document.querySelectorAll('a[href]'),
              ]
                .map((anchor) => {
                  try {
                    const url = new URL(anchor.href);

                    return (
                      url.hostname === 'www.dwtc.com' &&
                      /^\/en\/events\/[^/]+\/?$/.test(url.pathname)
                    )
                      ? url.href
                      : null;
                  } catch {
                    return null;
                  }
                })
                .filter(Boolean);

              return new Set(urls).size > previousCount;
            },
            previousCount,
            { timeout: 5000 }
          );
        } catch {
          // Collect links once more before deciding to stop.
        }

        await collectEventLinks();

        if (candidates.size <= previousCount) {
          break;
        }
      }

      const urlsToVisit = [...candidates.keys()].slice(
        0,
        config.maxEventsPerJob
      );

      console.log(
        `DWTC event detail URLs to process: ${urlsToVisit.length}`
      );

      const events = [];

      onProgress({
        phase: 'scraping',
        message: `Scraping 0 of ${urlsToVisit.length} event pages...`,
        total: urlsToVisit.length,
        done: 0,
      });
            for (let i = 0; i < urlsToVisit.length; i++) {
        if (signal?.aborted) {
          logger.warn?.('Scrape aborted by signal.');
          break;
        }

        const url = urlsToVisit[i];
        let page;

        try {
          page = await context.newPage();
          page.setDefaultNavigationTimeout(config.navTimeoutMs);

          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              await page.goto(url, {
                waitUntil: 'domcontentloaded',
              });
              break;
            } catch (err) {
              if (attempt === 1) throw err;
              await page.waitForTimeout(1000);
            }
          }

          await page.waitForLoadState('networkidle', {
            timeout: 5000,
          }).catch(() => {});

          const event = await parseEventPage(
            await page.content(),
            url
          );

          if (
            event.dateRange &&
            !overlapsMonth(event.dateRange, year, month)
          ) {
            continue;
          }

          if (!event.dateRange) {
            event.scrapeStatus = 'DATE_UNVERIFIED';
          }

          let people = {
            speakers: [],
            exhibitors: [],
            sponsors: [],
            host: [],
          };

          if (
            event.externalUrl &&
            safeExternal(event.externalUrl, config.eventsUrl)
          ) {
            const externalPage = await context.newPage();
            const externalDeadline =
              Date.now() + (config.externalEventTimeoutMs ?? 20000);

            const remainingExternalMs = () =>
              Math.max(0, externalDeadline - Date.now());

            const externalNavigationTimeout = (cap = 8000) =>
              Math.max(1000, Math.min(cap, remainingExternalMs()));

            try {
              const homepageTimeout = externalNavigationTimeout(10000);

              if (remainingExternalMs() <= 0) {
                throw new Error('External event time budget exhausted.');
              }

              await externalPage.goto(event.externalUrl, {
                waitUntil: 'domcontentloaded',
                timeout: homepageTimeout,
              });

              const homepageIdleWait = Math.min(
                2500,
                remainingExternalMs()
              );

              if (homepageIdleWait > 0) {
                await externalPage.waitForLoadState('networkidle', {
                  timeout: homepageIdleWait,
                }).catch(() => {});
              }

              const homepageHtml = await externalPage.content();
              people = parseExternalPeople(homepageHtml);

              const subpageUrls = discoverExternalSubpages(
                homepageHtml,
                event.externalUrl
              );

              // Limit external-site processing so one slow website
              // cannot stall the entire monthly scrape.
              const configuredMax = config.maxExternalSubpages ?? 3;
              const maxSubpages = Math.min(
                subpageUrls.length,
                configuredMax,
                3
              );

              for (let sp = 0; sp < maxSubpages; sp++) {
                if (
                  signal?.aborted ||
                  remainingExternalMs() < 1500
                ) {
                  break;
                }

                if (
                  people.speakers.length &&
                  people.exhibitors.length &&
                  people.sponsors.length &&
                  people.host.length
                ) {
                  break;
                }

                const subPage = await context.newPage();

                try {
                  const timeout = externalNavigationTimeout(6000);

                  if (remainingExternalMs() <= 0) {
                    break;
                  }

                  await subPage.goto(subpageUrls[sp], {
                    waitUntil: 'domcontentloaded',
                    timeout,
                  });

                  const idleWait = Math.min(
                    1500,
                    remainingExternalMs()
                  );

                  if (idleWait > 0) {
                    await subPage.waitForLoadState('networkidle', {
                      timeout: idleWait,
                    }).catch(() => {});
                  }

                  const subPeople = parseExternalPeople(
                    await subPage.content()
                  );

                  for (const field of [
                    'speakers',
                    'exhibitors',
                    'sponsors',
                    'host',
                  ]) {
                    const current = people[field] || [];
                    const sub = subPeople[field] || [];

                    if (!sub.length) continue;

                    if (
                      !current.length ||
                      (current.length <= 2 && sub.length > current.length)
                    ) {
                      people[field] = sub;
                    } else {
                      const merged = [...current, ...sub];
                      people[field] = [...new Set(merged)];
                    }
                  }
                } catch (subErr) {
                  logger.warn?.('External sub-page failed', {
                    url: subpageUrls[sp],
                    error: subErr.message,
                  });
                } finally {
                  await subPage.close().catch(() => {});
                }
              }

              console.log(`\nEvent: ${event.name}`);
              console.log('Speakers:', people.speakers);
              console.log('Exhibitors:', people.exhibitors);
              console.log('Sponsors:', people.sponsors);
              console.log('Host:', people.host);
            } catch (error) {
              event.scrapeStatus = 'EXTERNAL_UNAVAILABLE';

              failures.push({
                name: event.name,
                reason: 'External event website unavailable',
              });

              logger.warn?.('External event page failed', {
                event: event.name,
                error: error.message,
              });
            } finally {
              await externalPage.close().catch(() => {});
            }
          } else if (!event.externalUrl) {
            event.scrapeStatus =
              event.scrapeStatus || 'NO_EXTERNAL_LINK';
          }

          const hasExternal = Object.values(people).some(
            (values) => values.length
          );

          events.push({
            name: event.name,
            dateText: event.dateText,
            venue: event.venue,
            eventType: event.eventType,
            industry: event.industry,
            audience: event.audience,
            organisedBy: event.organisedBy,
            description: event.description,
            speakers: people.speakers,
            exhibitors: people.exhibitors,
            sponsors: people.sponsors,
            host: people.host,
            dwtcUrl: event.dwtcUrl,
            externalUrl: event.externalUrl,
            scrapeStatus:
              event.scrapeStatus ||
              (hasExternal ? 'OK' : 'PARTIAL'),
          });

          // Save each completed event immediately.
          // This preserves results if the overall job times out.
          onEvent(events[events.length - 1]);
        } catch (error) {
          failures.push({
            name: url,
            reason: 'Event detail page failed to load',
          });

          logger.warn?.('Event page failed', {
            event: url,
            error: error.message,
          });
        } finally {
          await page?.close().catch(() => {});

          onProgress({
            phase: 'scraping',
            message: `Scraping event ${i + 1} of ${urlsToVisit.length}...`,
            total: urlsToVisit.length,
            done: i + 1,
          });
        }
      }

      onProgress({
        phase: 'completed',
        message: `Completed ${target.label} (${events.length} events)`,
        total: urlsToVisit.length,
        done: urlsToVisit.length,
      });

      console.log(
        `Events matching ${target.label}: ${events.length}`
      );

      return {
        events,
        failures,
        truncated: candidates.size > config.maxEventsPerJob,
      };
    } finally {
      signal?.removeEventListener('abort', abortHandler);
      await listing?.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }

  return {
    scrape,

    async close() {
      if (browserPromise) {
        const b = await browserPromise.catch(() => null);
        await b?.close().catch(() => {});
        browserPromise = null;
      }
    },
  };
}