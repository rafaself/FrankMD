import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/javascript/**/*.test.js'],
    environment: 'node',
  },
})
