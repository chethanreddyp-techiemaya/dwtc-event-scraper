export class ConfigError extends Error {
  constructor(message) { super(message); this.name = 'ConfigError'; }
}

export function loadConfig(env = process.env) {
  const raw = env.DWTC_EVENTS_URL;
  if (!raw) throw new ConfigError('DWTC_EVENTS_URL is required in the server environment.');
  let eventsUrl;
  try { eventsUrl = new URL(raw); } catch { throw new ConfigError('DWTC_EVENTS_URL must be a valid URL.'); }
  if (!['http:', 'https:'].includes(eventsUrl.protocol)) throw new ConfigError('DWTC_EVENTS_URL must use HTTP or HTTPS.');
  const number = (key, fallback, min, max) => {
    const value = Number(env[key]);
    return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
  };
  return Object.freeze({
    eventsUrl: eventsUrl.toString(),
    yearMin: number('DWTC_YEAR_MIN', 2020, 2000, 2100),
    yearMax: number('DWTC_YEAR_MAX', 2035, 2000, 2100),
    headless: env.DWTC_HEADLESS !== 'false',
    concurrency: number('DWTC_SCRAPER_CONCURRENCY', 3, 1, 5),
    navTimeoutMs: number('DWTC_NAV_TIMEOUT_MS', 45000, 5000, 120000),
    jobTimeoutMs: number('DWTC_JOB_TIMEOUT_MS', 600000, 30000, 1800000),
    maxEventsPerJob: number('DWTC_MAX_EVENTS_PER_JOB', 150, 1, 500),
    resultTtlMs: number('DWTC_RESULT_TTL_MS', 3600000, 60000, 86400000),
    maxRunningJobs: number('DWTC_MAX_RUNNING_JOBS', 2, 1, 10)
  });
}
