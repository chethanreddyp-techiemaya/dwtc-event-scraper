import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDateRange, overlapsMonth, parseEventPage, parseExternalPeople } from '../dwtc-parser.mjs';

test('29 Sep to 1 Oct 2026 overlaps September and October', () => {
  const range = parseDateRange('29 Sep - 1 Oct 2026');
  assert.ok(range);
  assert.equal(overlapsMonth(range, 2026, 9), true);
  assert.equal(overlapsMonth(range, 2026, 10), true);
  assert.equal(overlapsMonth(range, 2026, 11), false);
});

test('parses detail page title and visit website URL', () => {
  const html = '<html><body><h1>GOTECH 2026</h1><p>29 Sep - 1 Oct 2026</p><a href="https://example.org">VISIT EVENT WEBSITE</a></body></html>';
  const event = parseEventPage(html, 'https://www.dwtc.com/en/events/gotech-2026/');
  assert.equal(event.name, 'GOTECH 2026');
  assert.equal(event.externalUrl, 'https://example.org/');
});

test('missing external sections are empty arrays', () => {
  const fields = parseExternalPeople('<html><body><h1>Event</h1></body></html>');
  assert.deepEqual(fields, { speakers: [], exhibitors: [], sponsors: [], host: [] });
});

test('extracts organiser without mixing in the description', () => {
  const html = `
    <html>
      <body>
        <h1>GOTECH 2026</h1>
        <div class="event-organiser">
          <span>Organised By:</span>
          <span>SPE Middle East</span>
        </div>
        <div class="event-description">
          <p>GOTECH 2026 is a prestigious conference and exhibition.</p>
        </div>
      </body>
    </html>
  `;

  const event = parseEventPage(
    html,
    'https://www.dwtc.com/en/events/gotech-2026/'
  );

  assert.equal(event.organisedBy, 'SPE Middle East');
  assert.ok(!event.organisedBy.includes('prestigious conference'));
});

test('extracts event description from page content', () => {
  const html = `
    <html>
      <body>
        <h1>GOTECH 2026</h1>
        <div class="event-description">
          <p>GOTECH 2026 brings together global thought leaders.</p>
          <p>Participants explore innovation and sustainability.</p>
        </div>
      </body>
    </html>
  `;

  const event = parseEventPage(
    html,
    'https://www.dwtc.com/en/events/gotech-2026/'
  );

  assert.ok(event.description.includes('global thought leaders'));
  assert.ok(event.description.includes('innovation and sustainability'));
});