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

  const { catalogCron } = await import('./lib/limits');
  if (catalogCron === 'off') {
    console.log('[cron] catalog refresh disabled (MISE_CATALOG_CRON=off)');
    return;
  }

  const { schedule, validate } = await import('node-cron');
  if (!validate(catalogCron)) {
    console.warn(
      `[cron] invalid MISE_CATALOG_CRON expression %j — scheduled refresh disabled`,
      catalogCron,
    );
    return;
  }

  const { refreshFromPlex } = await import('./lib/catalog');

  schedule(catalogCron, async () => {
    const t0 = Date.now();
    try {
      const result = await refreshFromPlex({ force: false });
      console.log(
        '[cron] catalog refresh tick: count=%d elapsed=%dms',
        result.count,
        Date.now() - t0,
      );
    } catch (err) {
      console.warn(
        '[cron] catalog refresh failed: %s',
        err instanceof Error ? err.message : String(err),
      );
    }
  });

  console.log('[cron] catalog refresh scheduled: %s', catalogCron);
}
