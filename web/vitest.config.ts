import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['tests/**/*.test.ts', 'components/**/*.test.ts', 'lib/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**'],
  },
})
