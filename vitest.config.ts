import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'node',
    // Several legacy tests intentionally exercise the shared user-scoped
    // telemetry file. Parallel files race on that process-wide fixture.
    fileParallelism: false,
    // Points HARNESS_STATE_DIR at an isolated temp dir before any test
    // module loads, so the suite never touches the real user's ~/.harness.
    setupFiles: ['tests/setup/isolate-state.ts'],
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
  },
})
