# woffice

> ⚠️ **注意：本项目目前存在问题，暂不支持使用。**
>
> 当前版本仍处于开发调试阶段，部分交互与功能尚未达到可用状态，
> 请勿在生产环境或正式项目中使用。待问题修复后会移除此提示。

Word 文档编辑服务库（纯 TypeScript，无框架依赖）。

## 安装

```bash
pnpm add woffice
```

## 使用

```ts
import { WofficeApp } from 'woffice'

const app = new WofficeApp({
  container: document.getElementById('app')!, // 必填：挂载容器
  content: myDocument,                          // 可选：初始文档（默认空文档）
  title: '未命名文档',                           // 可选：标题 + 导出文件名
  viewMode: 'page',                             // 可选：'page'（默认）| 'flow'
  toolbar: true,                                // 可选：true 默认 / false 隐藏 / 数组自定义
  statusbar: true,                              // 可选：状态栏开关
  header: true,                                 // 可选：顶栏开关
  onChange: (doc) => console.log(doc),          // 可选：文档变化回调
})

// 需要命令式操作时，用 app.editor 访问底层 Editor
app.editor.commands.run('mark.bold')
```

`WofficeApp` 是库自带的 UI 外壳（顶栏 + 工具栏 + 画布 + 状态栏），
内置插件的全部命令、页面/流式视图、页码、字数统计、docx 导入导出都已就绪；
样式已内联，无需额外引入 CSS。

底层 Headless API（不想要外壳时）：

```ts
import { Editor, createDocument, createElement, createText } from 'woffice'

const editor = new Editor(createDocument([createElement('paragraph', [createText('Hello')])]))
editor.mount(document.getElementById('editor')!)
```

## 开发

```bash
pnpm install    # 安装依赖
pnpm dev        # 监听模式构建 + demo（http://localhost:8080，默认空白文档）
                # 加 ?sample 可加载示例文档：http://localhost:8080/?sample
pnpm build      # 构建到 dist/（ESM + CJS + 类型声明）
pnpm test       # 单元测试（vitest）
pnpm e2e        # 端到端测试（Playwright + 真实浏览器）
pnpm lint       # 代码检查
```

> 端到端用例在 `test/e2e/`，默认使用系统安装的 Google Chrome
> （`channel: 'chrome'`，见 `playwright.config.ts`）。若未安装 Chrome，
> 改为 `pnpm exec playwright install chromium` 后把 `channel` 去掉即可。

## 发布

```bash
pnpm build
pnpm publish
```

## License

MIT
