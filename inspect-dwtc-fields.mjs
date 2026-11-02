
import { chromium } from 'playwright';

const urls = [
    'https://www.dwtc.com/en/events/gotech-2026/',
    'https://www.dwtc.com/en/events/beautyworld-dubai-2026/',
    'https://www.dwtc.com/en/events/water-energy-technology-and-environment-exhibition-wetex-2026/'
];

const browser = await chromium.launch({ headless: true });

try {
    const page = await browser.newPage();

    for (const url of urls) {
        console.log('\n\n========================================');
        console.log('PAGE:', url);
        console.log('========================================');

        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        await page.waitForLoadState('networkidle', {
            timeout: 15000
        }).catch(() => { });

        const result = await page.evaluate(() => {
            const normalize = (text) =>
                (text || '').replace(/\s+/g, ' ').trim();

            // --------------------------------------------------
            // 1. Inspect exact field labels
            // --------------------------------------------------

            const labels = [
                'LOCATION',
                'ORGANISED BY',
                'ORGANIZED BY'
            ];

            const fields = {};

            for (const label of labels) {
                fields[label] = [];

                const elements = [...document.querySelectorAll('body *')];

                for (const element of elements) {
                    if (element.children.length !== 0) continue;

                    const text = normalize(element.textContent)
                        .replace(/:\s*$/, '')
                        .toUpperCase();

                    if (text !== label) continue;

                    let parent = element;

                    // Capture the real HTML structure around each field.
                    for (let level = 0; level < 3; level++) {
                        if (parent.parentElement) {
                            parent = parent.parentElement;
                        }
                    }

                    fields[label].push({
                        labelText: normalize(element.textContent),
                        parentText: normalize(parent.innerText).slice(0, 1500),
                        parentHTML: parent.outerHTML.slice(0, 5000)
                    });

                    if (fields[label].length >= 3) break;
                }
            }

            // --------------------------------------------------
            // 2. Find organiser-related text anywhere on page
            // --------------------------------------------------

            const organiserCandidates = [];

            const allElements = [
                ...document.querySelectorAll('body *')
            ];

            for (const element of allElements) {
                // Only inspect leaf elements to avoid duplicate
                // parent and child text entries.
                if (element.children.length !== 0) continue;

                const text = normalize(element.textContent);

                if (!/organis|organis[sz]ed|organizer/i.test(text)) {
                    continue;
                }

                const parent = element.parentElement;

                organiserCandidates.push({
                    tag: element.tagName,
                    className: element.getAttribute('class') || '',
                    text,
                    parentTag: parent?.tagName || '',
                    parentClass: parent?.getAttribute('class') || '',
                    parentText: normalize(parent?.innerText).slice(0, 1500),
                    parentHTML: parent?.outerHTML.slice(0, 5000) || ''
                });

                if (organiserCandidates.length >= 30) break;
            }

            // --------------------------------------------------
            // 3. Inspect description candidates
            // --------------------------------------------------

            const descriptionParagraphs = [
                ...document.querySelectorAll(
                    'main p, article p, [class*="description"] p, [class*="Description"] p'
                )
            ]
                .map((p) => normalize(p.innerText))
                .filter((text) => text.length > 30)
                .slice(0, 20);

            // --------------------------------------------------
            // 4. Inspect elements whose class names mention
            //    description or organiser
            // --------------------------------------------------

            const relatedElements = [];

            for (const element of allElements) {
                const className =
                    typeof element.className === 'string'
                        ? element.className
                        : '';

                if (
                    /description|organis|organizer/i.test(className)
                ) {
                    const text = normalize(element.innerText);

                    if (!text) continue;

                    relatedElements.push({
                        tag: element.tagName,
                        className,
                        text: text.slice(0, 2000),
                        html: element.outerHTML.slice(0, 5000)
                    });

                    if (relatedElements.length >= 30) break;
                }
            }

            return {
                title: document.title,
                fields,
                organiserCandidates,
                descriptionParagraphs,
                relatedElements
            };
        });

        console.log(JSON.stringify(result, null, 2));
    }
} finally {
    await browser.close();
}
