import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // node:sqlite emits an ExperimentalWarning; keep test output pristine.
    execArgv: ['--no-warnings'],
  },
});
