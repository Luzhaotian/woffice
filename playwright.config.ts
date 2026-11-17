import { defineConfig } from '@playwright/test'

/**
 * woffice 端到端用例配置
 *
 * 直接跑 demo（vite dev server，端口 8080），用真实 Chromium 验证编辑器行为。
 * 运行：pnpm e2e
 */
export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8080',
    // 使用系统安装的 Google Chrome（Playwright 自带浏览器需单独下载）
    channel: 'chrome',
    headless: true,
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:8080',
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
