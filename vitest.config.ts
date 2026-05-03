import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    // Each test file gets its own pglite, so isolation is per-file. Allowing
    // parallel files speeds the suite while keeping each file's DB pristine.
    fileParallelism: true,
    // The first call to embed/listMovies in the source still references env;
    // pglite tests don't actually fire either, but real code paths read env
    // on import.
    setupFiles: [],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
});
