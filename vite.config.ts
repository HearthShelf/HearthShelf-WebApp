import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { execSync } from 'node:child_process'

function gitShortSha(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    // Shallow/no-git checkouts (some CI environments) - fall back rather than fail the build.
    return 'unknown'
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : undefined,
  resolve: {
    alias: {
      '@hearthshelf/core': path.resolve(__dirname, './packages/core/src'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    // Baked in at build time so Settings > Account > Advanced can show which
    // deploy is actually loaded - the giveaway when a browser (or a car's
    // embedded browser cache) is still serving a stale bundle.
    __BUILD_COMMIT__: JSON.stringify(process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7) ?? gitShortSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
})
