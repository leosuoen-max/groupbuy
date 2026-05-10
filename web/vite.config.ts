import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const VIRTUAL_ID = 'virtual:deploy-build-id'
const RESOLVED = '\0' + VIRTUAL_ID

function deployVersionPlugin(): Plugin {
  let buildId = ''

  return {
    name: 'deploy-version',
    configResolved(config) {
      buildId = config.command === 'build' ? randomUUID() : 'dev'
    },
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED
    },
    load(id) {
      if (id === RESOLVED) {
        return `export const DEPLOY_BUILD_ID = ${JSON.stringify(buildId)}`
      }
    },
    closeBundle() {
      if (!buildId || buildId === 'dev') return
      const out = path.join(__dirname, 'dist', 'build-info.json')
      fs.mkdirSync(path.dirname(out), { recursive: true })
      fs.writeFileSync(out, JSON.stringify({ buildId }), 'utf8')
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), deployVersionPlugin()],
})
