import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'node',
    // Several legacy tests intentionally exercise the shared user-scoped
    // telemetry file. Parallel files race on that process-wide fixture.
    fileParallelism: false,
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
  },
})
