
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
    /\b(\d{1,2})\s+([A-Za-z]{3,9})\s*(?:-|–|—|to)\s*(\d{1,2})\s+([A-Za-z]{3,9})[,]?\s*(20\d{2})\b/i
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
    /\b(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([A-Za-z]{3,9})[,]?\s*(20\d{2})\b/i
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
    /\b([A-Za-z]{3,9})\s+(\d{1,2})\s*(?:-|–|—|to)\s*(?:([A-Za-z]{3,9})\s+)?(\d{1,2})[,]?\s*(20\d{2})\b/i
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
        /\b(?:Held under the patronage|Marking a historic milestone|GOTECH 2026 is a prestigious conference|The event brings together|The event offers|This year's|This year’s|With\s+\d[\d,]*\+?\s+(?:exhibitors|attendees|industry experts))\b/i
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
    /\b(?:\d{1,2}\s+[A-Za-z]{3,9}\s*(?:-|–|—|to)\s*\d{1,2}\s+[A-Za-z]{3,9}|\d{1,2}\s*[-–]\s*\d{1,2}\s+[A-Za-z]{3,9}|[A-Za-z]{3,9}\s+\d{1,2}\s*(?:-|–|—|to)\s*(?:[A-Za-z]{3,9}\s+)?\d{1,2})[,]?\s*20\d{2}\b/i;

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

export function parseExternalPeople(html) {
  const $ = cheerio.load(html);

  $('script, style, noscript, svg').remove();

  const headings = $('h1, h2, h3, h4, h5, [role="heading"]').toArray();

  const result = {
    speakers: [],
    exhibitors: [],
    sponsors: [],
    host: []
  };

  const rules = {
    speakers: [
      /^speakers?$/i,
      /keynote speakers?/i,
      /speaker line.?up/i
    ],
    exhibitors: [
      /^exhibitors?$/i,
      /exhibition directory/i
    ],
    sponsors: [
      /^sponsors?$/i,
      /our partners/i,
      /supporting partners/i,
      /partners and sponsors/i
    ],
    host: [
      /^host$/i,
      /^hosts$/i,
      /hosted by/i,
      /event host/i
    ]
  };

  for (const [key, patterns] of Object.entries(rules)) {
    for (const heading of headings) {
      const headingText = normalize($(heading).text());

      if (!patterns.some((pattern) => pattern.test(headingText))) {
        continue;
      }

      const section = $(heading).next();

      const candidates = section
        .find('li, a, [class*="name"], [class*="title"]')
        .toArray()
        .map((element) => normalize($(element).text()));

      const fallback = normalize(section.text())
        .split(/[;\n|•]/)
        .map(normalize);

      result[key] = [
        ...new Set(
          (candidates.length ? candidates : fallback).filter(
            (value) =>
              value.length > 1 &&
              value.length < 100 &&
              !patterns.some((pattern) => pattern.test(value))
          )
        )
      ].slice(0, 100);

      if (result[key].length) break;
    }
  }

  return result;
}
