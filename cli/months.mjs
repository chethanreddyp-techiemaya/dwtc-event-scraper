
const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const MONTH_LOOKUP = new Map();

MONTHS.forEach((name, index) => {
  const monthNumber = index + 1;

  // Accept full month names: october
  MONTH_LOOKUP.set(name, monthNumber);

  // Accept abbreviated month names: oct
  MONTH_LOOKUP.set(name.slice(0, 3), monthNumber);
});

export function parseMonths(input) {
  if (!input || typeof input !== "string") {
    throw new Error(
      'Please provide months. Example: "oct 2026, nov 2026"'
    );
  }

  // Split comma-separated month entries.
  const entries = input.split(",").map((entry) => entry.trim());

  if (entries.some((entry) => !entry)) {
    throw new Error("Invalid input. Check the month list.");
  }

  const parsedMonths = entries.map((entry) => {
    // Accept formats such as:
    // oct 2026
    // october 2026
    // OCTOBER 2026
    const match = entry
      .toLowerCase()
      .match(/^([a-z]+)\s+(20\d{2})$/);

    if (!match) {
      throw new Error(
        `Invalid month format: "${entry}". Use "oct 2026" or "october 2026".`
      );
    }

    const monthName = match[1];
    const year = Number(match[2]);
    const month = MONTH_LOOKUP.get(monthName);

    if (!month) {
      throw new Error(`Unknown month: "${monthName}".`);
    }

    if (year < 2000 || year > 2100) {
      throw new Error(`Invalid year: "${year}".`);
    }

    return {
      year,
      month,
      label: `${MONTHS[month - 1].slice(0, 3).toUpperCase()} ${year}`,
    };
  });

  // Deduplicate month entries.
  const uniqueMonths = [];
  const seen = new Set();

  for (const item of parsedMonths) {
    const key = `${item.year}-${item.month}`;

    if (!seen.has(key)) {
      seen.add(key);
      uniqueMonths.push(item);
    }
  }

  return uniqueMonths;
}
