import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDateRange, overlapsMonth, parseEventPage, parseExternalPeople, discoverExternalSubpages } from '../dwtc-parser.mjs';

test('29 Sep to 1 Oct 2026 overlaps September and October', () => {
  const range = parseDateRange('29 Sep - 1 Oct 2026');
  assert.ok(range);
  assert.equal(overlapsMonth(range, 2026, 9), true);
  assert.equal(overlapsMonth(range, 2026, 10), true);
  assert.equal(overlapsMonth(range, 2026, 11), false);
});

test('parses detail page title and visit website URL', async () => {
  const html = '<html><body><h1>GOTECH 2026</h1><p>29 Sep - 1 Oct 2026</p><a href="https://example.org">VISIT EVENT WEBSITE</a></body></html>';
  const event = await parseEventPage(html, 'https://www.dwtc.com/en/events/gotech-2026/');
  assert.equal(event.name, 'GOTECH 2026');
});

test('missing external sections are empty arrays', () => {
  const fields = parseExternalPeople('<html><body><h1>Event</h1></body></html>');
  assert.deepEqual(fields, { speakers: [], exhibitors: [], sponsors: [], host: [] });
});

test('extracts organiser without mixing in the description', async () => {
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

  const event = await parseEventPage(
    html,
    'https://www.dwtc.com/en/events/gotech-2026/'
  );

  assert.equal(event.organisedBy, 'SPE Middle East');
  assert.ok(!event.organisedBy.includes('prestigious conference'));
});

test('extracts event description from page content', async () => {
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

  const event = await parseEventPage(
    html,
    'https://www.dwtc.com/en/events/gotech-2026/'
  );

  assert.ok(event.description.includes('global thought leaders'));
  assert.ok(event.description.includes('innovation and sustainability'));
});


// ── Bug regression: portal instruction text must not be treated as exhibitors ──
test('rejects form/portal instruction text as exhibitor names', () => {
  const instructionPhrases = [
    'company address', 'social media pages', 'stand and hall number',
    'marketing contact details', 'exhibiting staff members',
    'product offerings', 'along with company name',
  ];
  const items = instructionPhrases.map(p => `<li>${p}</li>`).join('');
  const html = `<html><body><h2>Exhibitors</h2><ul>${items}</ul></body></html>`;
  const result = parseExternalPeople(html);
  assert.equal(result.exhibitors.length, 0,
    `Instruction phrases should not appear as exhibitors; got: ${JSON.stringify(result.exhibitors)}`);
});

// ── Bug regression: nav/UI fragments must not become sponsor names ──
test('rejects navigation and UI fragments as sponsor names', () => {
  const navFragments = [
    'Plan your show', 'download', 'About', 'Register', 'Login',
    'Home', 'Search', 'Privacy', 'Terms',
  ];
  const items = navFragments.map(p => `<a href="#">${p}</a>`).join('');
  const html = `<html><body><h2>Partners</h2><div>${items}</div></body></html>`;
  const result = parseExternalPeople(html);
  assert.equal(result.sponsors.length, 0,
    `Nav fragments should not appear as sponsors; got: ${JSON.stringify(result.sponsors)}`);
});

// ── Bug regression: generic placeholder image alt text rejected ──
test('rejects generic numbered image alt text as sponsor names', () => {
  // Simulates "website logo-01" through "website logo-05" style alts
  const imgs = Array.from({ length: 5 }, (_, i) =>
    `<img alt="website logo-0${i + 1}" />`
  ).join('');
  const html = `<html><body><div class="sponsor-logos">${imgs}</div></body></html>`;
  const result = parseExternalPeople(html);
  assert.equal(result.sponsors.length, 0,
    `Placeholder alts should not be treated as sponsors; got: ${JSON.stringify(result.sponsors)}`);
});

// ── Bug regression: tier label alt text stripped to yield company name ──
test('strips tier label prefix from image alt text to extract company name', () => {
  // e.g. "EventName - Gold Sponsors - CompanyName" → "CompanyName"
  const html = `<html><body>
    <h2>Sponsors</h2>
    <div>
      <img alt="Acme Expo - Gold Sponsors - AlphaWidgets" />
      <img alt="Acme Expo - Silver Sponsors - BetaSystems" />
      <img alt="Acme Expo - Bronze Sponsors - GammaGroup" />
    </div>
  </body></html>`;
  const result = parseExternalPeople(html);
  assert.ok(result.sponsors.includes('AlphaWidgets'),
    `Should extract "AlphaWidgets"; got: ${JSON.stringify(result.sponsors)}`);
  assert.ok(result.sponsors.includes('BetaSystems'),
    `Should extract "BetaSystems"; got: ${JSON.stringify(result.sponsors)}`);
  assert.ok(result.sponsors.includes('GammaGroup'),
    `Should extract "GammaGroup"; got: ${JSON.stringify(result.sponsors)}`);
});

// ── Bug regression: standalone tier labels not treated as sponsor names ──
test('rejects standalone tier labels as sponsor names', () => {
  const tierLabels = [
    'Gold Sponsors', 'Silver Sponsors', 'Bronze Sponsors',
    'Platinum Partners', 'Official Sponsors', 'Diamond Sponsors',
  ];
  const items = tierLabels.map(l => `<li>${l}</li>`).join('');
  const html = `<html><body><h2>Sponsors</h2><ul>${items}</ul></body></html>`;
  const result = parseExternalPeople(html);
  // None of the extracted sponsors should be a pure tier label.
  for (const s of result.sponsors) {
    assert.ok(!/^(?:gold|silver|bronze|platinum|diamond|official)\s+(?:sponsors?|partners?)$/i.test(s),
      `Tier label "${s}" should not appear as a sponsor`);
  }
});

// ── Bug regression: legitimate company names after tier prefix must survive ──
test('preserves legitimate names that happen to contain tier words', () => {
  // "Gold River Technologies" is a real company name, not a tier label.
  const html = `<html><body>
    <h2>Sponsors</h2>
    <ul>
      <li>Gold River Technologies</li>
      <li>Silver Line Logistics</li>
    </ul>
  </body></html>`;
  const result = parseExternalPeople(html);
  assert.ok(result.sponsors.includes('Gold River Technologies'),
    `Should keep "Gold River Technologies"; got: ${JSON.stringify(result.sponsors)}`);
  assert.ok(result.sponsors.includes('Silver Line Logistics'),
    `Should keep "Silver Line Logistics"; got: ${JSON.stringify(result.sponsors)}`);
});

test('extracts sponsors from heading and following section (image alts)', () => {
  const html = `
    <html><body>
      <h2>Sponsors</h2>
      <div>
        <a href="/s1"><img alt="Acme Corp" /></a>
        <a href="/s2"><img alt="Globex Inc" /></a>
        <a href="/s3"><img alt="Initech" /></a>
      </div>
    </body></html>
  `;
  const result = parseExternalPeople(html);
  assert.ok(result.sponsors.includes('Acme Corp'), 'Should find Acme Corp');
  assert.ok(result.sponsors.includes('Globex Inc'), 'Should find Globex Inc');
  assert.ok(result.sponsors.includes('Initech'), 'Should find Initech');
});

test('extracts sponsors from class-based container (no heading, ≥2 images)', () => {
  const html = `
    <html><body>
      <div class="sponsor-logos">
        <img alt="Alpha Tech" /><img alt="Beta Corp" /><img alt="Gamma Ltd" />
      </div>
    </body></html>
  `;
  const result = parseExternalPeople(html);
  assert.ok(result.sponsors.length >= 2, 'Should find sponsors from class-based container');
});

test('extracts host from "Organised by" text fallback', () => {
  const html = `
    <html><body>
      <p>This event is organised by International Expo Group.</p>
    </body></html>
  `;
  const result = parseExternalPeople(html);
  assert.ok(result.host.length > 0, 'Should extract host');
  assert.ok(result.host[0].includes('International Expo Group'),
    'Host should be International Expo Group');
});

test('extracts speakers from heading section', () => {
  const html = `
    <html><body>
      <h3>Keynote Speakers</h3>
      <ul>
        <li>Dr. Jane Smith</li>
        <li>Prof. John Doe</li>
      </ul>
    </body></html>
  `;
  const result = parseExternalPeople(html);
  assert.ok(result.speakers.includes('Dr. Jane Smith'));
  assert.ok(result.speakers.includes('Prof. John Doe'));
});

test('discoverExternalSubpages finds relevant links only on same domain', () => {
  const html = `
    <html><body>
      <a href="/sponsors">Sponsors</a>
      <a href="/speakers">Speakers</a>
      <a href="/about">About</a>
      <a href="/register">Register</a>
      <a href="https://other.com/page">External</a>
    </body></html>
  `;
  const links = discoverExternalSubpages(html, 'https://example.com/');
  assert.ok(links.some(l => l.includes('/sponsors')), 'Should find sponsors link');
  assert.ok(links.some(l => l.includes('/speakers')), 'Should find speakers link');
  assert.ok(links.some(l => l.includes('/about')), 'Should find about link');
  assert.ok(!links.some(l => l.includes('other.com')), 'Should not include external domain');
});

test('does not treat DWTC or venue names as sponsors', () => {
  const html = `
    <html><body>
      <h2>Sponsors</h2>
      <div>
        <a>DWTC</a>
        <a>Real Sponsor Co</a>
      </div>
    </body></html>
  `;
  const result = parseExternalPeople(html);
  assert.ok(!result.sponsors.some(s => /^dwtc$/i.test(s)), 'DWTC should be excluded');
  assert.ok(result.sponsors.includes('Real Sponsor Co'), 'Real sponsor should be included');
});

test('deduplicates extracted names across a section', () => {
  const html = `
    <html><body>
      <h2>Sponsors</h2>
      <div>
        <a>Acme Corp</a>
        <a>Acme Corp</a>
        <a>Beta Inc</a>
      </div>
    </body></html>
  `;
  const result = parseExternalPeople(html);
  const acmeCount = result.sponsors.filter(s => s === 'Acme Corp').length;
  assert.equal(acmeCount, 1, 'Acme Corp should appear only once');
});

test('missing external sections return empty arrays', () => {
  const fields = parseExternalPeople('<html><body><h1>Event</h1></body></html>');
  assert.deepEqual(fields, { speakers: [], exhibitors: [], sponsors: [], host: [] });
});
