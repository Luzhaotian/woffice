# CLAUDE.md

Claude Code 在本仓库工作时的指引。**开始改代码前先读这份文件。**

## 项目一句话

`woffice`：纯 TypeScript、框架无关的 Word 风格文档编辑服务库；自研编辑内核 + 自研 docx（OOXML / zip），
核心层不依赖 DOM。设计细节见 `docs/design-plan.md`。

## 环境与命令

- Node v26.13.0（`.nvmrc`），pnpm 10，TypeScript 7（strict）
- `pnpm install` 安装依赖
- `pnpm dev` 开发服务器（http://localhost:8080）
- `pnpm build` 构建（`vite build` → `tsc` → `scripts/fix-dts-alias.mjs`）
- `pnpm test -- --run` 单次跑全部测试（`pnpm test` 是 watch 模式）
- `pnpm e2e` Playwright 端到端用例（真实浏览器跑 demo，默认用系统 Chrome）
- `pnpm lint` oxlint

## 架构速览

```
应用 / 使用方封装（Vue / React / 原生 DOM，由使用方自行封装）
┌────────────────────────────────────────────────────┐
│ Editor API（src/editor.ts）                          │
├──────────┬──────────┬──────────┬──────────┬─────────┤
│ model    │ engine   │ render   │ input    │ convert │
│ 纯数据   │ 纯逻辑   │ 浏览器   │ 浏览器   │ 纯函数  │
└──────────┴──────────┴──────────┴──────────┴─────────┘
              plugins（Schema + Commands + Keymap）
```

- `src/model/`：Node / Path / Schema / normalize / serialize / traverse
- `src/engine/`：State / Step / Transaction / History / Selection / commands / registry
- `src/render/`：Renderer（增量渲染）/ EditorView
- `src/input/`：ContenteditableBackend
- `src/plugins/`：插件类型 + `builtin/`（blocks / lists / marks / behaviors / table）
- `src/convert/docx/`：自研 zip + OOXML 导入导出
- `src/app/`：`WofficeApp` UI 外壳（顶栏 / 工具栏 / 画布 / 状态栏，样式内联）

## 硬性约定（违反会破坏架构）

1. **导入用 `@/` 别名**（`@` → `src/`），不要写相对路径。
   改 `src` 结构时记得同步 `vite.config.ts` 的 `resolve.alias` 与 `tsconfig.json` 的 `paths`。
2. **`src/model` / `src/engine` / `src/convert` 禁止 import 浏览器 API**
   （`document` / `window` / `DOMParser` / `Blob` 等）。浏览器逻辑只放 `render/`、`input/`、`app/`、`demo/`。
   这是"核心层可独立测试、可跑 Node"的前提。
3. **所有文档修改必须走 Steps**（可序列化 + 可逆），不要绕过事务直接改文档树。
   为后续协同编辑预留。
4. **事务提交前必须 `normalize`**，保证模型 canonical。
5. **选区以 DOM 为准并回写模型**：`EditorView` 监听 `selectionchange`，用
   `Editor.setSelection()` 同步；`editor.getSelection()` 优先读 DOM。
   命令触发重渲染后选区会丢失，需要时用 `renderer.setSelection(anchor, head)` 恢复
   （参考 `WofficeApp.run`）。
6. **UI 外壳是库的一部分**：内置命令的 UI 都在 `src/app/` 的 `WofficeApp`。
   新增内置命令时同步登记到外壳（`MARK_TYPES` / `BLOCK_TOGGLES` / `buildToolbarButton` /
   `DEFAULT_TOOLBAR`）。demo 只传配置，不要在 demo 里重写 UI。
7. 新增 Step 必须补 `apply + invert` 往返一致性测试。
8. DOM 相关测试首行加 `// @vitest-environment happy-dom`；纯逻辑测试不需要。
9. 注释与测试描述用中文。

## 构建陷阱

`tsc` 不会改写 import 路径 —— 源码里的 `@/` 会被原样写进 `dist/*.d.ts`，
发布后使用方无法解析。`scripts/fix-dts-alias.mjs` 会在构建末尾把 `dist` 下 `.d.ts`
的 `@/` 还原成相对路径。**改了构建链路后务必重新 `pnpm build` 验证。**

## 测试

- 测试文件镜像 `src/` 结构，放 `test/` 对应目录，命名 `*.test.ts`
- 运行：`pnpm test -- --run`
- 核心不变量：Step `apply + invert`、normalize 幂等、选区映射
- DOM / 输入闭环测试参考 `test/render/editor-view.test.ts`
- **端到端**：`test/e2e/*.spec.ts`（`pnpm e2e`），vitest 已排除该目录；
  编辑器选区是**文本节点位置**，构造选区用文本节点而非元素范围

## 不要做的事

- 不要引入任何三方编辑架构（ProseMirror / Lexical / Slate …）
- 不要引入三方 docx / zip 库（OOXML 与 zip 必须保持自研）
- 不要给包加框架 peer deps（Vue / React 等）
- 不要提交 `dist/` 或 `node_modules/`
