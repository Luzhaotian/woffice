/**
 * woffice demo
 *
 * 默认挂载一个空白文档，可直接点「导入 .docx」打开文件测试。
 * 加 `?sample` 加载示例文档（demo 展示 / e2e 用例用）。
 */

import { WofficeApp } from '@/index'
import { createSampleDocument } from './sample'

const withSample = new URLSearchParams(window.location.search).has('sample')

const app = new WofficeApp({
  container: document.getElementById('app')!,
  content: withSample ? createSampleDocument() : undefined,
  title: withSample ? '欢迎使用 woffice' : undefined,
})

// 需要命令式操作时，用 app.editor 访问底层 Editor
export { app }
