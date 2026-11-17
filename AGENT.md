# AGENT.md

面向 AI 编码助手的项目说明。修改代码前请先读完本文。

## 项目概览

`woffice` 是一个纯 TypeScript、框架无关的 Word 风格文档编辑服务库（MIT）。

- **自研编辑内核**：不依赖 ProseMirror / Lexical / Slate 等任何三方编辑架构
- **docx 完全自研**：OOXML + zip（含 CRC32、deflate/stored）均为自研，不使用三方 docx / zip 库
- **核心层无 DOM**：`src/model`、`src/engine`、`src/convert` 不 import 浏览器 API，可独立测试
- **框架无关**：包不绑定 Vue / React，由使用方自行封装
- 设计详见 `docs/design-plan.md`（M0–M7 已落地）

## 技术栈

| 项 | 版本 / 说明 |
|---|---|
| Node | v26.13.0（`.nvmrc`） |
| 包管理 | pnpm 10 |
| TypeScript | 7，strict + `verbatimModuleSyntax` |
| 构建 | Vite 8，单 entry，ESM + CJS 双格式 |
| 测试 | Vitest 5（happy-dom 用于 DOM 测试） |
| Lint | oxlint |

## 常用命令

```bash
pnpm install          # 安装依赖
pnpm dev              # 开发服务器 http://localhost:8080（demo 页面）
pnpm build            # 构建到 dist/（vite build → tsc → d.ts 路径还原）
pnpm test             # watch 模式运行测试
pnpm test -- --run    # 单次运行全部测试
pnpm e2e              # Playwright 端到端用例（真实浏览器跑 demo）
pnpm lint             # oxlint
```

## 目录结构

```
src/
├── model/         纯数据：节点 / Path / Schema / 规范化 / 序列化 / 遍历
│   ├── node.ts         Node / TextNode / ElementNode / VoidNode 类型与工厂
│   ├── path.ts         Path / Position
│   ├── schema.ts       Schema + basicSchema + buildSchema
│   ├── normalize.ts    规范化（合并文本节点、删空节点、结构约束）
│   ├── serialize.ts    JSON 序列化
│   └── traverse.ts     遍历 / 查询 / 更新
├── engine/        纯逻辑：状态 / 步骤 / 事务 / 历史 / 选区 / 命令
│   ├── state.ts        EditorState（doc + selection）
│   ├── step.ts         Step 原语（apply + invert 往返一致）
│   ├── transaction.ts  一组 Step + 选区映射
│   ├── history.ts      撤销 / 重做栈（含输入合并）
│   ├── selection.ts    TextSelection
│   ├── commands.ts     命令工厂
│   └── registry.ts     CommandRegistry + KeymapTable
├── render/        浏览器：DOM 渲染（增量）/ 视图模式 / 分页
│   ├── renderer.ts     doc → DOM，语义 path ↔ DOM 双向映射
│   └── view.ts         EditorView 组装
├── input/         浏览器：输入后端
│   └── backend.ts      ContenteditableBackend（beforeinput / IME / 剪贴板 / 快捷键）
├── plugins/       插件系统
│   ├── plugin.ts       Plugin / Command / Keymap 类型
│   └── builtin/       内置插件：blocks / lists / marks / behaviors / table
├── convert/       导入导出（纯函数）
│   └── docx/          自研 zip + OOXML + 编号 + import/export
├── app/           UI 外壳（WofficeApp：顶栏 / 工具栏 / 画布 / 状态栏）
│   ├── editor-app.ts   外壳组件（内置命令全部 UI）
│   ├── editor-app.css  外壳样式（?inline 内联，使用方零配置）
│   └── icons.ts        内置图标
├── editor.ts      Editor 主类：组装各层、暴露 API
└── index.ts         公共 API 入口
```

```
test/              与 src 对应的单元测试（vitest）
├── model/ engine/ render/ plugins/ convert/ performance/
├── fixtures/        rich.docx 等夹具
├── e2e/            Playwright 端到端用例（真实浏览器，跑 demo）
└── index.test.ts
demo/               demo：index.html（页面骨架）+ main.ts（挂载 WofficeApp 并传配置）
scripts/            构建后处理脚本
playwright.config.ts  e2e 配置（默认用系统 Chrome：channel: 'chrome'）
```

## 约定（重要）

1. **导入路径统一用 `@/` 别名**（`@` → `src/`），不要写 `../` 之类的相对路径。
   - 源码、测试、demo 全部适用
   - `vite.config.ts` 的 `resolve.alias` 与 `tsconfig.json` 的 `paths` 需同步维护
2. **核心层禁止 import 浏览器 API**：`src/model`、`src/engine`、`src/convert` 中不得出现
   `document` / `window` / `DOMParser` 等；浏览器相关逻辑只放在 `render/`、`input/`、`app/`、`demo/`。
3. **文档修改必须走 Steps**：所有变更通过可序列化、可逆的 Step 表达，
   为后续协同编辑（CRDT / OT）预留，不要直接改 `doc` 树后绕过事务。
4. **每次事务提交前必须 normalize**，保证模型 canonical（唯一表示）。
5. **选区以 DOM 为准并回写模型**：`EditorView` 监听 `selectionchange`，
   通过 `Editor.setSelection()` 把 DOM 选区同步为模型选区；
   `editor.getSelection()` 优先读 DOM。不要另建一套选区状态。
6. **重渲染后选区会丢失**：命令触发渲染（DOM 被替换）后，
   需要恢复选区时用 `renderer.setSelection(anchor, head)`（参考 `WofficeApp.run`）。
7. **空块必须有占位 `<br>`**：渲染器对没有子节点的块级元素要补一个 `<br>`，
   否则高度为 0、光标看不见也点不中（表现为"回车/点击失效"）。
   `reconcileChildren` 会移除占位 `<br>`，所以每次渲染后都要重新补。
8. **UI 外壳是库的一部分**：内置命令的 UI 都在 `src/app/` 的 `WofficeApp` 里；
   新增内置命令时，同步在 `MARK_TYPES` / `BLOCK_TOGGLES` / `buildToolbarButton` 中登记，
   并加到 `DEFAULT_TOOLBAR`。demo 只负责传配置，不要在 demo 里重写 UI。
9. **DOM 相关测试**在文件首行加 `// @vitest-environment happy-dom`；
   纯逻辑测试不需要。
10. 代码注释、测试描述用中文。
11. `dist/` 不入库（`.gitignore` 已配置），它是构建产物。

## 构建注意事项

`pnpm build` = `vite build` + `tsc` + `node scripts/fix-dts-alias.mjs`。

- 因为源码使用 `@/` 别名，`tsc` 会把 `@/x/y` 原样写进 `.d.ts`，导致发布后使用方无法解析。
- `scripts/fix-dts-alias.mjs` 负责把 `dist` 下 `.d.ts` 里的 `@/` 还原成相对路径。
- **不要**在 `dist` 目录或该脚本的注释里写会破坏语法的内容；修改脚本后请重新 `pnpm build` 验证。

## 测试约定

- 测试文件与 `src/` 目录结构对应，命名 `*.test.ts`
- 断言优先用 `toEqual` / `toMatchObject`；模型不变量测试见 `test/model/normalize.test.ts`
- Step 的 `apply + invert` 往返一致性是核心不变量，新增 Step 必须补该测试
- 运行：`pnpm test -- --run`
- **端到端用例**放 `test/e2e/*.spec.ts`，由 Playwright 运行（`pnpm e2e`），
  vitest 已在 `vite.config.ts` 中排除该目录；e2e 需要真实浏览器交互，
  编辑器的"选区"是**文本节点位置**，构造选区请用文本节点而不是元素范围
