import { defineConfig } from 'vitest/config'
// Share one React instance across DSH client packages and tests.
export default defineConfig({ resolve: { dedupe: ['react', 'react-dom'] }, test: {
  include: ['tests/**/*.spec.{ts,tsx}'], server: { deps: { inline: ['@deepseek-ai/dsh-client-ui-primitives'] } },
} })
