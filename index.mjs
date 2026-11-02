import { loadConfig } from './config.mjs';
import { createRenderer } from './playwright-renderer.mjs';
import { createDwtcService } from './service.mjs';
import { createDwtcRouter } from './router.mjs';
import { defaultLogger } from './log.mjs';

/**
 * Wire everything. In the host app:
 *   import { setupDwtc } from './dwtc/index.mjs';
 *   const dwtc = setupDwtc({ express });
 *   app.use('/api/dwtc', requireAuth, dwtc.router);
 *   process.on('SIGTERM', dwtc.shutdown);
 * Throws ConfigError at startup if DWTC_EVENTS_URL is missing/invalid (fail fast).
 */
export function setupDwtc({ express, logger = defaultLogger, env = process.env }) {
  const config = loadConfig(env);
  const renderer = createRenderer(config, logger);
  const service = createDwtcService({ config, renderer, logger });
  return { router: createDwtcRouter({ express, service, logger }), service, shutdown: service.shutdown };
}
