/**
 * Next 16 instrumentation hook. Runs ONCE per server process, before any
 * route handler. Use it for one-time server bootstrapping — here, the daily
 * catalog refresh cron.
 *
 * IMPORTANT: this file is also loaded in the Edge runtime for middleware
 * compilation, so guard all node-only work behind NEXT_RUNTIME === 'nodejs'.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { logger } = await import('./lib/logger');
  const log = logger.child({ component: 'cron' });

  const { catalogCron } = await import('./lib/limits');
  if (catalogCron === 'off') {
    log.info('catalog refresh disabled (MISE_CATALOG_CRON=off)');
    return;
  }

  const { schedule, validate } = await import('node-cron');
  if (!validate(catalogCron)) {
    log.warn({ expression: catalogCron }, 'invalid MISE_CATALOG_CRON; scheduled refresh disabled');
    return;
  }

  const { refreshFromPlex } = await import('./lib/catalog');

  schedule(catalogCron, async () => {
    const t0 = Date.now();
    try {
      const result = await refreshFromPlex({ force: false });
      log.info({ count: result.count, elapsedMs: Date.now() - t0 }, 'catalog refresh tick');
    } catch (err) {
      log.warn(
        { err, elapsedMs: Date.now() - t0 },
        'catalog refresh failed',
      );
    }
  });

  log.info({ schedule: catalogCron }, 'catalog refresh scheduled');
}
