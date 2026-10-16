import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],

    // Every test file boots its own PGlite instance against the single
    // DATABASE_DIR the run was given (see `task test:server`, which points it at
    // a throwaway mktemp dir). With file-level parallelism two workers open that
    // same data dir at once and race inside PGlite's WASM filesystem, which
    // surfaces at collection time as an opaque `ErrnoError: { errno: 20 }`
    // (ENOTDIR) and fails whichever suite lost. It looks random because it is:
    // the same command sometimes reports 192/192 and sometimes not.
    //
    // The suite is therefore inherently serial — shared state is the point of it
    // — and runs in ~52s instead of ~40s. Per-worker databases would keep the
    // parallelism but cost a full migration pass and ~40MB each, which is not
    // worth it for 12 seconds.
    fileParallelism: false,
  },
});
