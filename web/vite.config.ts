import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { defineConfig, loadEnv } from 'vite'
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

/** 微信若直接抓 SPA 壳子（如用户分享当前页 `/feituan`），补默认 og:*；图片须绝对 URL（相对路径爬虫常打不开）。 */
function injectDefaultOpenGraph(originFromEnv: string): Plugin {
  return {
    name: 'inject-default-og',
    transformIndexHtml(html) {
      const fallbackOrigin = 'https://groupbuy-app-24c46.web.app'
      const o = (originFromEnv.trim() || fallbackOrigin).replace(/\/+$/, '')
      const ogImage = `${o}/feituan-logo.png`
      const block = `
    <meta name="description" content="今日精选团购，与朋友一起拼单下单。" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="大马饭团" />
    <meta property="og:title" content="大马饭团" />
    <meta property="og:description" content="今日精选团购，与朋友一起拼单下单。" />
    <meta property="og:image" content="${ogImage}" />
    <meta property="og:image:secure_url" content="${ogImage}" />
    <meta property="og:image:alt" content="大马饭团" />
    <meta property="og:url" content="${o}/" />`
      return html.replace('</head>', `${block}\n  </head>`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')
  /** 未设置时 OG 域名由 injectDefaultOpenGraph 内 fallback 兜底（生产默认 web.app）。 */
  const appOrigin = (env.VITE_PUBLIC_APP_ORIGIN || '').trim().replace(/\/+$/, '')

  return {
    plugins: [react(), deployVersionPlugin(), injectDefaultOpenGraph(appOrigin)],
  }
})
