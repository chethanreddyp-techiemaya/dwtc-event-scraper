
import * as cheerio from 'cheerio';

// ============================================================
// Constants and utilities
// ============================================================

export const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export const normalize = (s = '') =>
  String(s).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

const monthIndex = Object.fromEntries(
  monthNames.flatMap((month, index) => [
    [month.toLowerCase(), index],
    [month.slice(0, 3).toLowerCase(), index]
  ])
);

const escapeRegex = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ============================================================
// Date parsing
// ============================================================

function validRange(start, end) {
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end < start
  ) {
    return null;
  }

  return { start, end };
}

export function parseDateRange(input = '') {
  const text = normalize(input);
  let match = text.match(
    /\b(\d{1,2})\s+([A-Za-z]{3,9})\s*(?:-|â€“|â€”|to)\s*(\d{1,2})\s+([A-Za-z]{3,9})[,]?\s*(20\d{2})\b/i
  );

  // Example: 29 Sep - 1 Oct 2026
  if (match) {
    const startMonth = monthIndex[match[2].toLowerCase()];
    const endMonth = monthIndex[match[4].toLowerCase()];

    if (startMonth !== undefined && endMonth !== undefined) {
      let startYear = Number(match[5]);
      const endYear = Number(match[5]);

      if (startMonth > endMonth) startYear--;

      return validRange(
        new Date(startYear, startMonth, Number(match[1])),
        new Date(endYear, endMonth, Number(match[3]))
      );
    }
  }

  // Example: 29-30 Sep 2026
  match = text.match(
    /\b(\d{1,2})\s*[-â€“]\s*(\d{1,2})\s+([A-Za-z]{3,9})[,]?\s*(20\d{2})\b/i
  );

  if (match && monthIndex[match[3].toLowerCase()] !== undefined) {
    const year = Number(match[4]);
    const month = monthIndex[match[3].toLowerCase()];

    return validRange(
      new Date(year, month, Number(match[1])),
      new Date(year, month, Number(match[2]))
    );
  }

  // Example: Sep 29 - Oct 1 2026
  match = text.match(
    /\b([A-Za-z]{3,9})\s+(\d{1,2})\s*(?:-|â€“|â€”|to)\s*(?:([A-Za-z]{3,9})\s+)?(\d{1,2})[,]?\s*(20\d{2})\b/i
  );

  if (match) {
    const startMonth = monthIndex[match[1].toLowerCase()];
    const endMonth = monthIndex[(match[3] || match[1]).toLowerCase()];

    if (startMonth !== undefined && endMonth !== undefined) {
      let startYear = Number(match[5]);
      const endYear = Number(match[5]);

      if (startMonth > endMonth) startYear--;

      return validRange(
        new Date(startYear, startMonth, Number(match[2])),
        new Date(endYear, endMonth, Number(match[4]))
      );
    }
  }

  // Example: 29 Sep 2026
  match = text.match(
    /\b(\d{1,2})\s+([A-Za-z]{3,9})[,]?\s*(20\d{2})\b/i
  );

  if (match && monthIndex[match[2].toLowerCase()] !== undefined) {
    const date = new Date(
      Number(match[3]),
      monthIndex[match[2].toLowerCase()],
      Number(match[1])
    );

    return validRange(date, date);
  }

  return null;
}

export function overlapsMonth(range, year, month) {
  if (!range) return false;

  return (
    range.start <= new Date(year, month, 0, 23, 59, 59, 999) &&
    range.end >= new Date(year, month - 1, 1)
  );
}

// ============================================================
// Event detail page parsing
// ============================================================

export async function parseEventPage(html, url) {
  const $ = cheerio.load(html);

  $('script, style, noscript, svg').remove();

  const body = normalize($('body').text());

  const name = normalize(
    $('h1').first().text() ||
    $('meta[property="og:title"]').attr('content') ||
    $('title').text()
  );

  const knownLabels =
    'TIME\\s*&\\s*DATE|LOCATION|EVENT TYPE|INDUSTRY|AUDIENCE|' +
    'ORGANI[ZS]ED BY|ORGANIZED BY';

  // ----------------------------------------------------------
  // Clean metadata values
  // ----------------------------------------------------------

  function cleanFieldValue(value, label = '') {
    let result = normalize(value);

    result = result
      .replace(/^\s*(?:Organised|Organized)\s+By\s*:\s*/i, '')
      .replace(/\+?\s*Read More\s*/gi, ' ')
      .replace(/\bAdd to my calendar\b/gi, ' ')
      .replace(/\bFollow Event\b/gi, ' ')
      .trim();

    // Stop at the next known metadata label.
    result = result
      .split(
        new RegExp(
          `\\s+(?:${knownLabels})\\s*:?`,
          'i'
        )
      )[0]
      .trim();

    if (/^organi[sz]ed by$/i.test(label)) {
      const descriptionStart = result.search(
        /\b(?:Held under the patronage|Marking a historic milestone|GOTECH 2026 is a prestigious conference|The event brings together|The event offers|This year's|This yearâ€™s|With\s+\d[\d,]*\+?\s+(?:exhibitors|attendees|industry experts))\b/i
      );

      if (descriptionStart >= 0) {
        result = result.slice(0, descriptionStart).trim();
      }
    }

    return result.slice(0, 500);
  }

  // ----------------------------------------------------------
  // Extract a labelled field
  // ----------------------------------------------------------

  const valueFor = (label) => {
    const normalizedLabel = label
      .replace(/:\s*$/, '')
      .toLowerCase();

    const labelElements = $('body *').filter((_, element) => {
      if ($(element).children().length !== 0) return false;

      const text = normalize($(element).text())
        .replace(/:\s*$/, '')
        .toLowerCase();

      return text === normalizedLabel;
    });

    const element = labelElements.first();

    if (element.length) {
      // Look at the immediate next sibling.
      const next = normalize(element.next().text());

      if (next && next.toLowerCase() !== normalizedLabel) {
        return cleanFieldValue(next, label);
      }

      // Inspect sibling elements separately.
      const siblings = element.parent().children().not(element).toArray();

      for (const sibling of siblings) {
        const candidate = normalize($(sibling).text());

        if (
          candidate &&
          candidate.toLowerCase() !== normalizedLabel &&
          !new RegExp(`^(?:${knownLabels})\\s*:?$`, 'i').test(candidate)
        ) {
          return cleanFieldValue(candidate, label);
        }
      }

      // Handle a label and value inside the same container.
      const parentText = normalize(element.parent().text());

      const cleaned = normalize(
        parentText.replace(
          new RegExp(`^${escapeRegex(label)}\\s*:?\\s*`, 'i'),
          ''
        )
      );

      if (cleaned && cleaned !== parentText) {
        return cleanFieldValue(cleaned, label);
      }
    }

    // Fallback for plain-text metadata.
    const expression = new RegExp(
      `${escapeRegex(label)}\\s*:?\\s*(.*?)(?=\\s+(?:${knownLabels})\\b|$)`,
      'i'
    );

    return cleanFieldValue(body.match(expression)?.[1] || '', label);
  };

  // ----------------------------------------------------------
  // Venue: use the actual DWTC venue markup.
  // The live page uses p.fcaption and p.flocation.
  // Multiple p.flocation elements represent multiple halls.
  // ----------------------------------------------------------

  const getVenue = () => {
  const locationLabel = $('p.fcaption')
    .filter((_, element) =>
      normalize($(element).text())
        .replace(/:\s*$/, '')
        .toLowerCase() === 'location'
    )
    .first();

  if (!locationLabel.length) {
    return valueFor('LOCATION');
  }

  const card = locationLabel.closest(
    '.EventsHighlightsBlockstyled__FeatureIconCard-sc-6npq6g-3'
  );

  if (!card.length) {
    return valueFor('LOCATION');
  }

  const venues = card
    .find('p.flocation')
    .map((_, element) => {
      return normalize($(element).text())
        .replace(/\s*,+\s*/g, ', ')
        .replace(/,+\s*$/g, '')
        .trim();
    })
    .get()
    .filter(Boolean);

  // Join venue values and remove duplicate commas/spaces.
  return [...new Set(venues)]
    .join(', ')
    .replace(/\s*,+\s*/g, ', ')
    .replace(/,\s*$/g, '')
    .slice(0, 1500);
};

  // ----------------------------------------------------------
  // Organiser: extract from the actual DWTC figcaption markup.
  // Example:
  // <figcaption>Organised By: <span>SPE Middle East</span></figcaption>
  // ----------------------------------------------------------

  const getOrganisedBy = () => {
  // DWTC event pages contain organiser information in a figcaption.
  // Example:
  // <figcaption>Organised By: <span>SPE Middle East</span></figcaption>

  const captions = $('figcaption');

  for (const element of captions.toArray()) {
    const caption = $(element);
    const captionText = normalize(caption.text());

    // Correctly match both "Organised By:" and "Organized By:"
    if (!/^organi[sz]ed\s+by\s*:/i.test(captionText)) {
      continue;
    }

    // Prefer the organiser name inside the span.
    const organiserName = normalize(caption.find('span').last().text());

    if (organiserName) {
      return cleanFieldValue(
        organiserName,
        'ORGANISED BY'
      ).slice(0, 300);
    }

    // Fallback if the caption has no span.
    const value = captionText.replace(
      /^organi[sz]ed\s+by\s*:\s*/i,
      ''
    );

    const cleaned = cleanFieldValue(value, 'ORGANISED BY');

    if (cleaned) {
      return cleaned.slice(0, 300);
    }
  }

  // Fallback for pages with a separate label and value.
  const labelPattern = /^Organ(?:ised|ized)\s+By\s*:?\s*$/i;

  const labelElements = $('body *').filter((_, element) => {
    if ($(element).children().length !== 0) {
      return false;
    }

    return labelPattern.test(normalize($(element).text()));
  });

  for (const element of labelElements.toArray()) {
    const label = $(element);
    const next = normalize(label.next().text());

    if (
      next &&
      !labelPattern.test(next) &&
      !/read more|add to my calendar|follow event/i.test(next)
    ) {
      const cleaned = cleanFieldValue(next, 'ORGANISED BY');

      if (cleaned) {
        return cleaned.slice(0, 300);
      }
    }

    const parent = label.parent();

    const siblingValues = parent
      .children()
      .not(label)
      .toArray()
      .map((sibling) => normalize($(sibling).text()))
      .filter(Boolean);

    for (const value of siblingValues) {
      const cleaned = cleanFieldValue(value, 'ORGANISED BY');

      if (
        cleaned &&
        !/read more|add to my calendar|follow event/i.test(cleaned)
      ) {
        return cleaned.slice(0, 300);
      }
    }

    const parentText = normalize(parent.text());

    const match = parentText.match(
      /^Organ(?:ised|ized)\s+By\s*:\s*(.+)$/i
    );

    if (match) {
      const cleaned = cleanFieldValue(match[1], 'ORGANISED BY');

      if (cleaned) {
        return cleaned.slice(0, 300);
      }
    }
  }

  // Final fallback: extract from the complete page text.
  const match = body.match(
    /\bOrgan(?:ised|ized)\s+By\s*:\s*(.{1,200}?)(?=\s+(?:TIME\s*&\s*DATE|LOCATION|EVENT TYPE|INDUSTRY|AUDIENCE)\b|$)/i
  );

  if (match) {
    return cleanFieldValue(match[1], 'ORGANISED BY').slice(0, 300);
  }

  return '';
};

  // ----------------------------------------------------------
  // Event date
  // ----------------------------------------------------------

  const datePattern =
    /\b(?:\d{1,2}\s+[A-Za-z]{3,9}\s*(?:-|â€“|â€”|to)\s*\d{1,2}\s+[A-Za-z]{3,9}|\d{1,2}\s*[-â€“]\s*\d{1,2}\s+[A-Za-z]{3,9}|[A-Za-z]{3,9}\s+\d{1,2}\s*(?:-|â€“|â€”|to)\s*(?:[A-Za-z]{3,9}\s+)?\d{1,2})[,]?\s*20\d{2}\b/i;

  const dateText =
    body.match(datePattern)?.[0] ||
    valueFor('TIME & DATE');

  // ----------------------------------------------------------
// External event website
// Resolve HTTP redirects and store the final destination URL.
// ----------------------------------------------------------

const anchor = $('a')
  .filter((_, element) =>
    /visit event website|event website|official website/i.test(
      normalize($(element).text())
    )
  )
  .first();

let externalUrl = '';

try {
  const href = anchor.attr('href');

  if (href) {
    const external = new URL(href, url);
    const currentPage = new URL(url);

    if (
      ['http:', 'https:'].includes(external.protocol) &&
      external.hostname !== currentPage.hostname
    ) {
      const originalUrl = external.toString();

      try {
        // Node.js fetch follows HTTP redirects automatically.
        const response = await fetch(originalUrl, {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(15000),
        });

        if (response.url) {
          const finalUrl = new URL(response.url);

          if (['http:', 'https:'].includes(finalUrl.protocol)) {
            externalUrl = finalUrl.toString();
          }
        }

        // Release the response body.
        await response.body?.cancel();
      } catch (error) {
        console.warn(
          `Could not resolve redirect for ${originalUrl}: ${error.message}`
        );
      }

      // Keep the original URL if redirect resolution fails.
      if (!externalUrl) {
        externalUrl = originalUrl;
      }
    }
  }
} catch {
  // Ignore malformed or missing URLs.
}

  // ----------------------------------------------------------
  // Description: prefer actual paragraph elements.
  // Exclude organiser labels and "Read More" controls.
  // ----------------------------------------------------------

  const cleanDescription = (value) =>
    normalize(value)
      .replace(/\+?\s*Read More\s*/gi, ' ')
      .replace(/\bAdd to my calendar\b/gi, ' ')
      .replace(/\bFollow Event\b/gi, ' ')
      .trim();

  const descriptionParts = [];

  // Prefer paragraphs inside description-related containers.
  const descriptionSelectors = [
    '[class*="event-description"]',
    '[class*="eventDescription"]',
    '[class*="description"]',
    '[id*="description"]',
    '[data-testid*="description"]'
  ];

  for (const selector of descriptionSelectors) {
    $(selector).each((_, container) => {
      const paragraphs = $(container).is('p')
        ? $(container)
        : $(container).find('p');

      paragraphs.each((_, paragraph) => {
        const text = cleanDescription($(paragraph).text());

        if (
          text.length > 30 &&
          !/^(?:Organised|Organized)\s+By\s*:/i.test(text) &&
          !descriptionParts.includes(text)
        ) {
          descriptionParts.push(text);
        }
      });
    });

    if (descriptionParts.length) break;
  }

  // Fallback: use content paragraphs, excluding metadata cards.
  if (!descriptionParts.length) {
    $('main p, article p').each((_, paragraph) => {
      const element = $(paragraph);
      const text = cleanDescription(element.text());

      const isMetadata = element.closest(
        '.EventsHighlightsBlockstyled__FeatureIconCard-sc-6npq6g-3'
      ).length > 0;

      if (
        !isMetadata &&
        text.length > 50 &&
        !/^(?:Organised|Organized)\s+By\s*:/i.test(text) &&
        !/^read more$/i.test(text) &&
        !descriptionParts.includes(text)
      ) {
        descriptionParts.push(text);
      }
    });
  }

  const metaDescription = cleanDescription(
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    ''
  );

  const description = (
    descriptionParts.length
      ? descriptionParts.join(' ')
      : metaDescription
  ).slice(0, 3000);

  // ----------------------------------------------------------
  // Final event object
  // ----------------------------------------------------------

  return {
    name,
    dateText,
    dateRange: parseDateRange(dateText || body),
    venue: getVenue(),
    eventType: valueFor('EVENT TYPE'),
    industry: valueFor('INDUSTRY'),
    audience: valueFor('AUDIENCE'),
    organisedBy: getOrganisedBy(),
    description,
    dwtcUrl: url,
    externalUrl,
    _body: body
  };
}


// ============================================================
// External speakers, exhibitors, sponsors and host parsing
// ============================================================

// ------------------------------------------------------------
// Generic validation helpers â€” no hardcoded brand/event names
// ------------------------------------------------------------

/**
 * Tier/category labels that describe a sponsorship level, not a company name.
 * Used to strip tier prefixes from image alt text, and to reject strings
 * that consist only of a tier label (e.g. "Gold Sponsors" standing alone).
 */
const TIER_LABEL_RE = /\b(?:session|headline|title|presenting|diamond|platinum|gold|silver|bronze|principal|strategic|knowledge|event|official|supporting|founding|premier|exclusive|major|associate|community|industry|media)\s+(?:sponsors?|partners?|supporters?|supply\s+partners?|exhibitors?)\b/i;

/**
 * Strings that are clearly not entity names: navigation fragments, single-word
 * UI chrome, form/portal instruction phrases, and generic image asset labels.
 * Matched against the fully-cleaned candidate (case-insensitive, `x` flag for
 * inline comments).
 */
const JUNK_VALUE_RE = /^(?:home|news|about|menu|search|login|logout|profile|register|submit|send|apply|close|open|back|next|prev|previous|skip|more|view|read|visit|here|link|follow|share|print|upload|download|media|support|help|faq|terms|privacy|cookie|copyright|\u00a9|enquiry|contact|email|website|company\s+(?:name|address|profile|info(?:rmation)?)|social\s+media(?:\s+pages?)?|stand\s+and\s+hall(?:\s+number)?|hall\s+number|marketing\s+contact(?:\s+details?)?|(?:exhibiting\s+)?staff\s+members?|product\s+offerings?|about\s+us|(?:check|update|set|confirm|review)\s+(?:your\s+)?\w.*|make\s+sure\s.*|opt[\s-]?(?:in|out)|along\s+with\b.*|so\s+you\s+only.*|your\s+(?:details|contact|marketing|information)\b.*|plan\s+your(?:\s+show)?|(?:website\s+)?logo(?:-\d+)?|image(?:\s*\d+)?|(?:brand|sponsor|partner|event|show|placeholder|default)\s+(?:logo|image)|\w+\s+logo-\d+|logo-\d+|white(?:\s+image)?|black(?:\s+image)?|host\s+city|venue\s+partner|dubai\s+world\s+trade\s+cent(?:re|er)?|dwtc|ticketing|don+w?n?load)$/i;

/**
 * Strip sponsorship tier prefixes embedded in image alt text, and remove
 * trailing " logo" / " image" suffixes.
 *
 * Works generically on any event website â€” does NOT hardcode event names.
 *
 * Pattern handled (any depth):
 *   "<Anything> - <TierLabel> - <CompanyName>"  â†’  "<CompanyName>"
 *   "<Anything> - <TierLabel>"                  â†’  ""  (fails isValidName)
 *   "<CompanyName> logo"                         â†’  "<CompanyName>"
 */
function cleanName(raw) {
  let name = normalize(raw)
    .replace(/^[-â€“â€”â€¢Â·â–¸â–ºâ–ª,\s]+/, '')
    .replace(/[-â€“â€”â€¢Â·â–¸â–ºâ–ª,\s]+$/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')   // trailing parentheticals
    .trim();

  // Iteratively strip "Prefix - TierLabel -" segments from the front.
  // Stops when no further tier-label prefix is present.
  let prev;
  do {
    prev = name;
    name = name.replace(
      /^[^-â€“â€”]{1,60}[-â€“â€”]\s*(?:\w+\s+)*(?:sponsors?|partners?|supporters?|supply\s+partner|exhibitors?)\s*[-â€“â€”]\s*/i,
      ''
    );
  } while (name !== prev);

  // Strip a trailing standalone tier label (e.g. "EventName - Gold Sponsors").
  name = name.replace(
    /^[^-â€“â€”]{1,60}[-â€“â€”]\s*(?:\w+\s+)*(?:sponsors?|partners?|supporters?|supply\s+partner|exhibitors?)\s*$/i,
    ''
  );

  // Strip trailing " logo" or " image" as whole words.
  name = name.replace(/\s+(?:logo|image)\s*$/i, '').trim();

  // Strip a single "EventOrBrand - " prefix when the remainder starts with
  // an uppercase character (heuristic: only one level, to avoid over-stripping).
  if (/^[A-Za-z][\w\s&]{3,50}[-â€“â€”]\s+[A-Z]/.test(name)) {
    name = name.replace(/^[A-Za-z][\w\s&.,']{3,50}[-â€“â€”]\s+/, '').trim();
  }

  return name;
}

/**
 * Returns true only if the candidate looks like a real entity name
 * (brand, organisation, or person) rather than UI chrome, a tier label,
 * a generic image descriptor, or a form instruction fragment.
 */
function isValidName(value) {
  if (!value || value.length < 2 || value.length > 100) return false;
  if (JUNK_VALUE_RE.test(value)) return false;
  // Reject standalone tier labels ("Gold Sponsors", "Official Partner" â€¦).
  if (TIER_LABEL_RE.test(value) && value.split(/\s+/).length <= 4) return false;
  // Reject sentence-length fragments.
  if (value.split(/\s+/).length > 8) return false;
  // Allow honorifics before checking for sentence-terminal punctuation.
  const noHonorifics = value.replace(/\b(?:dr|mr|mrs|ms|prof)\./gi, '');
  if (/[?!]/.test(noHonorifics)) return false;
  if (/^https?:\/\//i.test(value)) return false;
  if (/@/.test(value) && /\./.test(value)) return false;
  if (/^\d+$/.test(value)) return false;
  return true;
}

// ------------------------------------------------------------
// Section extraction helpers
// ------------------------------------------------------------

/**
 * Collect all DOM siblings that belong to the content section following a
 * heading, stopping at the next heading-level element. Also scans parent-
 * container children when the heading is inside a section/div wrapper.
 */
function getSectionSiblings($, heading) {
  const siblings = [];
  let current = $(heading).next();

  for (let i = 0; i < 20 && current.length; i++) {
    const tag = (current.prop('tagName') || '').toLowerCase();
    if (/^h[1-6]$/.test(tag) || current.is('[role="heading"]')) break;
    siblings.push(current);
    current = current.next();
  }

  const parent = $(heading).parent();
  const parentTag = (parent.prop('tagName') || '').toLowerCase();

  if (['section', 'div', 'article', 'main'].includes(parentTag)) {
    const children = parent.children().toArray();
    const idx = children.indexOf(heading);

    for (let i = idx + 1; i < children.length && i < idx + 20; i++) {
      const child = $(children[i]);
      const tag = (child.prop('tagName') || '').toLowerCase();
      if (/^h[1-6]$/.test(tag) || child.is('[role="heading"]')) break;
      if (!siblings.some((s) => s.is(child))) siblings.push(child);
    }
  }

  return siblings;
}

/**
 * Extract entity names from a single section element.
 *
 * Priority order (stops at first strategy that produces results):
 *   1. Structured list / semantic name elements (li, card, name, title â€¦).
 *      Prefers leaf-node image alt over concatenated deep text to avoid
 *      tier-label + company-name merging.
 *   2. Image alt text â€” most reliable signal for sponsor logo grids.
 *   3. Link-level signals: embedded image alt > link title > short link text.
 *   4. Plain text split on delimiter characters as last resort.
 */
function extractNamesFromElement($, section) {
  // 1. Structured semantic elements.
  const structured = section
    .find([
      'li',
      '[class*="name"]',
      '[class*="title"]',
      '[class*="card"]',
      '[class*="speaker"]',
      '[class*="sponsor"]',
      '[class*="partner"]',
    ].join(', '))
    .toArray()
    .map((el) => {
      const $el = $(el);
      // For elements that contain nested images (logo grids),
      // prefer the first image alt to avoid mixing tier labels into the text.
      const imgAlt = $el.find('img[alt]').first().attr('alt');
      const leafText = $el.children().length === 0 ? $el.text() : null;
      return cleanName(imgAlt ?? leafText ?? $el.text());
    })
    .filter(isValidName);

  if (structured.length) return structured;

  // 2. Image alt text.
  const altNames = section.find('img[alt]').toArray()
    .map((img) => cleanName($(img).attr('alt') || ''))
    .filter(isValidName);

  if (altNames.length) return altNames;

  // 3. Link-level signals (embedded alt > title > short link text â‰¤ 4 words).
  const linkNames = section.find('a').toArray().flatMap((link) => {
    const $link = $(link);
    const imgAlt   = cleanName($link.find('img').first().attr('alt') || '');
    const title    = cleanName($link.attr('title') || '');
    const text     = cleanName($link.text());
    const shortTxt = text.split(/\s+/).length <= 4 ? text : '';
    const candidate = imgAlt || title || shortTxt;
    return isValidName(candidate) ? [candidate] : [];
  });

  if (linkNames.length) return linkNames;

  // 4. Plain text split fallback - skip if section has links (avoids nav blob concatenation).
  if (section.find('a').length > 0) return [];
  return normalize(section.text())
    .split(/[;\n|\u2022,]/)
    .map(cleanName)
    .filter(isValidName);
}

/**
 * Extract all valid entity names from the content section that follows
 * the given heading element.
 */
function extractNamesFromSection($, heading, patterns) {
  const names = [];

  for (const section of getSectionSiblings($, heading)) {
    names.push(...extractNamesFromElement($, section));
  }

  // Deduplicate and remove any value that matches the section heading pattern
  // itself (e.g. the word "Sponsors" should not appear as a sponsor name).
  return [...new Set(names)]
    .filter((n) => !patterns.some((p) => p.test(n)))
    .slice(0, 100);
}

// ------------------------------------------------------------
// Public parsing functions
// ------------------------------------------------------------

export function parseExternalPeople(html) {
  const $ = cheerio.load(html);

  $('script, style, noscript, svg').remove();

  const headings = $('h1, h2, h3, h4, h5, h6, [role="heading"]').toArray();

  const result = {
    speakers:   [],
    exhibitors: [],
    sponsors:   [],
    host:       [],
  };

  const rules = {
    speakers: [
      /^speakers?$/i,
      /keynote speakers?/i,
      /speaker line.?up/i,
      /featured speakers?/i,
      /our speakers?/i,
    ],
    exhibitors: [
      /^exhibitors?$/i,
      /exhibition directory/i,
      /exhibitor list/i,
      /our exhibitors?/i,
    ],
    sponsors: [
      /^sponsors?$/i,
      /^partners?$/i,
      /our partners/i,
      /our sponsors/i,
      /supporting partners?/i,
      /partners\s*(?:and|&)\s*sponsors/i,
      /sponsors\s*(?:and|&)\s*partners/i,
      /official sponsors?/i,
      /platinum sponsors?/i,
      /gold sponsors?/i,
      /silver sponsors?/i,
      /bronze sponsors?/i,
      /title sponsors?/i,
      /strategic partners?/i,
      /event partners?/i,
      /knowledge partners?/i,
      /diamond sponsors?/i,
      /presenting sponsors?/i,
      /sponsored by/i,
      /supported by/i,
    ],
    host: [
      /^host$/i,
      /^hosts$/i,
      /hosted by/i,
      /event host/i,
      /^organi[sz]er$/i,
      /^organi[sz]ers$/i,
      /^organi[sz]ed by$/i,
      /^about the (?:organi[sz]er|host)/i,
    ],
  };

  // â”€â”€ Heading-based extraction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  for (const [key, patterns] of Object.entries(rules)) {
    for (const heading of headings) {
      const headingText = normalize($(heading).text());
      if (!patterns.some((p) => p.test(headingText))) continue;

      const names = extractNamesFromSection($, heading, patterns);
      if (names.length) {
        result[key] = names;
        break;
      }
    }
  }

  // â”€â”€ Fallback: class/id-based sponsor logo grid (no preceding heading) â”€â”€
  // Requires â‰¥ 2 valid image alt names to accept the container, to avoid
  // picking up navigation elements that happen to match class names.
  if (!result.sponsors.length) {
    for (const container of $(
      '[class*="sponsor"], [class*="partner"], [id*="sponsor"], [id*="partner"]'
    ).toArray()) {
      const names = [];
      $(container).find('img[alt]').each((_, img) => {
        const alt = cleanName($(img).attr('alt') || '');
        if (isValidName(alt)) names.push(alt);
      });
      const unique = [...new Set(names)];
      if (unique.length >= 2) {
        result.sponsors = unique.slice(0, 100);
        break;
      }
    }
  }

  // â”€â”€ Fallback: body-text "hosted/organised by â€¦" pattern for host â”€â”€â”€â”€â”€â”€â”€
  if (!result.host.length) {
    const body = normalize($('body').text());
    const match = body.match(
      /(?:hosted|organised|organized)\s+by\s*[:\s]\s*([A-Z][\w\s&.,'-]{2,80}?)(?:\.|,\s*(?:a|an|the|in|is)\b|$)/i
    );
    if (match) {
      const name = cleanName(match[1]);
      if (isValidName(name)) result.host = [name];
    }
  }

  return result;
}

/**
 * Discover same-domain subpage links from the external event homepage that
 * are likely to contain sponsors, speakers, exhibitors, or organiser info.
 * Returns up to 8 unique URLs for the renderer to visit.
 */
export function discoverExternalSubpages(html, baseUrl) {
  const $ = cheerio.load(html);
  const links = [];
  const seen = new Set();

  const relevantPatterns = [
    /sponsor/i,
    /partner/i,
    /exhibitor/i,
    /speaker/i,
    /about/i,
    /organi[sz]er/i,
    /who.?we.?are/i,
  ];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = normalize($(el).text()).toLowerCase();

    const isRelevant =
      relevantPatterns.some((p) => p.test(text)) ||
      relevantPatterns.some((p) => p.test(href));

    if (!isRelevant) return;

    try {
      const resolved = new URL(href, baseUrl);
      const base = new URL(baseUrl);
      if (resolved.hostname !== base.hostname) return;
      const key = resolved.origin + resolved.pathname;
      if (key === base.origin + base.pathname) return;
      if (seen.has(key)) return;
      seen.add(key);
      links.push(resolved.toString());
    } catch {
      // Ignore malformed URLs.
    }
  });

  return links.slice(0, 8);
}
