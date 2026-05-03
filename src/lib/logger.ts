import pino, { type Logger } from 'pino';

/**
 * Process-wide structured logger.
 *
 * In development (NODE_ENV !== 'production') we pipe through pino-pretty so
 * dev console output is human-readable. In production we emit one JSON line
 * per event — pipe to whatever log aggregator you have (or just `docker
 * compose logs app | jq`).
 *
 * Use child loggers (`logger.child({ sessionId })`) at any persistent boundary
 * so every event in that scope carries the same correlation fields.
 */
const isDev = process.env.NODE_ENV !== 'production';

declare global {
  // eslint-disable-next-line no-var
  var __miseLogger: Logger | undefined;
}

export const logger: Logger =
  globalThis.__miseLogger ??
  pino({
    level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
    base: { service: 'mise' },
    redact: {
      // Don't leak credentials / tokens if a code path ever logs an env or
      // request header by mistake.
      paths: [
        'PLEX_TOKEN',
        'ANTHROPIC_API_KEY',
        'DATABASE_URL',
        '*.PLEX_TOKEN',
        '*.ANTHROPIC_API_KEY',
        '*.authorization',
        '*.Authorization',
      ],
      remove: true,
    },
    transport: isDev
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
        }
      : undefined,
  });

if (process.env.NODE_ENV !== 'production') globalThis.__miseLogger = logger;
