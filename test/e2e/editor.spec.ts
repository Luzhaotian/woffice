/**
 * woffice 端到端用例（Playwright + 真实 Chromium）
 *
 * 覆盖：外壳渲染 / 行内格式 / 块类型 / 列表 / 引用 / 代码块 / 分割线 /
 *       修订模式 / 撤销重做 / 回车拆分 / 退格 / 链接 / 批注 / 视图切换 /
 *       标题 / 导入导出。
 *
 * 运行：pnpm e2e
 */
import { test, expect, Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/** 选中某元素内的全部文本（编辑器位置是文本节点位置，不能用元素范围） */
async function selectAll(page: Page, selector: string): Promise<void> {
  await page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      const texts: Text[] = []
      let node: Node | null
      while ((node = walker.nextNode())) texts.push(node as Text)
      if (texts.length === 0) return
      const range = document.createRange()
      range.setStart(texts[0], 0)
      range.setEnd(texts[texts.length - 1], texts[texts.length - 1].data.length)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
}

/** 把光标放到元素内第一个文本节点的指定偏移 */
async function caret(page: Page, selector: string, offset: number): Promise<void> {
  await page
    .locator(selector)
    .first()
    .evaluate((el, offset) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      const text = walker.nextNode() as Text
      const range = document.createRange()
      range.setStart(text, Math.min(offset, text.data.length))
      range.collapse(true)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    }, offset)
}

/** 把光标放到元素内最后一个文本节点的末尾 */
async function caretEnd(page: Page, selector: string): Promise<void> {
  await page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      let text: Text | null = null
      let node: Node | null = null
      while ((node = walker.nextNode())) text = node as Text
      const range = document.createRange()
      range.setStart(text!, text!.data.length)
      range.collapse(true)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
}

/** 读取页面第一个块的标签名 */
async function firstBlockTag(page: Page): Promise<string> {
  return page
    .locator('.woffice-page')
    .first()
    .evaluate((el) => el.children[0]?.tagName ?? '')
}

const SAMPLE_P = '这是一份在浏览器本地编辑的文档，所有数据都不会离开你的设备。'
const SAMPLE_H2 = '核心能力'
const SAMPLE_QUOTE = '点击右上角「导入 .docx」打开一个 Word 文件试试。'

// ---------------------------------------------------------------------------
// 外壳
// ---------------------------------------------------------------------------

test.describe('外壳渲染', () => {
  test('渲染顶栏 / 工具栏 / 画布 / 状态栏', async ({ page }) => {
    await page.goto('/?sample')
    await expect(page.locator('.woffice-app-header')).toBeVisible()
    await expect(page.locator('.woffice-app-toolbar')).toBeVisible()
    await expect(page.locator('.woffice-app-canvas')).toBeVisible()
    await expect(page.locator('.woffice-app-statusbar')).toBeVisible()
    await expect(page.locator('.woffice-app-canvas .woffice-editor-content')).toBeVisible()
  })

  test('状态栏显示页码与字数', async ({ page }) => {
    await page.goto('/?sample')
    await expect(page.locator('.woffice-app-status-item').nth(0)).toContainText('第 1 页 / 共 1 页')
    await expect(page.locator('.woffice-app-status-item').nth(1)).toContainText('字')
  })

  test('默认是页面视图（A4 页面 + 页码）', async ({ page }) => {
    await page.goto('/?sample')
    await expect(page.locator('.woffice-page')).toHaveCount(1)
    await expect(page.locator('.woffice-page-number')).toHaveText('1')
  })
})

// ---------------------------------------------------------------------------
// 行内格式
// ---------------------------------------------------------------------------

test.describe('行内格式', () => {
  test('加粗', async ({ page }) => {
    await page.goto('/?sample')
    await selectAll(page, '.woffice-page h2')
    await page.getByRole('button', { name: '加粗 (Mod-B)' }).click()
    await expect(page.locator('.woffice-page h2 strong')).toHaveText(SAMPLE_H2)
    await expect(page.getByRole('button', { name: '加粗 (Mod-B)' })).toHaveClass(/active/)
  })

  test('斜体', async ({ page }) => {
    await page.goto('/?sample')
    await selectAll(page, '.woffice-page h2')
    await page.getByRole('button', { name: '斜体 (Mod-I)' }).click()
    await expect(page.locator('.woffice-page h2 em')).toHaveText(SAMPLE_H2)
  })

  test('下划线', async ({ page }) => {
    await page.goto('/?sample')
    await selectAll(page, '.woffice-page h2')
    await page.getByRole('button', { name: '下划线 (Mod-U)' }).click()
    await expect(page.locator('.woffice-page h2 u')).toHaveText(SAMPLE_H2)
  })

  test('删除线', async ({ page }) => {
    await page.goto('/?sample')
    await selectAll(page, '.woffice-page h2')
    await page.getByRole('button', { name: '删除线' }).click()
    await expect(page.locator('.woffice-page h2 s')).toHaveText(SAMPLE_H2)
  })

  test('高亮', async ({ page }) => {
    await page.goto('/?sample')
    await selectAll(page, '.woffice-page h2')
    await page.getByRole('button', { name: '高亮' }).click()
    await expect(page.locator('.woffice-page h2 mark')).toHaveText(SAMPLE_H2)
  })

  test('行内代码', async ({ page }) => {
    await page.goto('/?sample')
    await selectAll(page, '.woffice-page h2')
    await page.getByRole('button', { name: '行内代码' }).click()
    await expect(page.locator('.woffice-page h2 code')).toHaveText(SAMPLE_H2)
  })

  test('链接写入 href', async ({ page }) => {
    await page.goto('/?sample')
    await selectAll(page, '.woffice-page h2')
    page.once('dialog', (dialog) => dialog.accept('https://example.com'))
    await page.getByRole('button', { name: '链接' }).click()
    await expect(page.locator('.woffice-page h2 a')).toHaveAttribute('href', 'https://example.com')
  })

  test('批注写入 comment mark', async ({ page }) => {
    await page.goto('/?sample')
    await selectAll(page, '.woffice-page h2')
    page.once('dialog', (dialog) => dialog.accept('测试批注内容'))
    await page.getByRole('button', { name: '批注' }).click()
    await expect(page.locator('.woffice-page h2 .woffice-mark-comment')).toHaveText(SAMPLE_H2)
  })

  test('光标在粗体文字内时按钮高亮', async ({ page }) => {
    await page.goto('/?sample')
    await caret(page, '.woffice-page strong', 1)
    await expect(page.getByRole('button', { name: '加粗 (Mod-B)' })).toHaveClass(/active/)
    await expect(page.getByRole('button', { name: '斜体 (Mod-I)' })).not.toHaveClass(/active/)
  })
})

// ---------------------------------------------------------------------------
// 块类型
// ---------------------------------------------------------------------------

test.describe('块类型', () => {
  test('块类型下拉跟随光标', async ({ page }) => {
    await page.goto('/?sample')
    await caret(page, '.woffice-page h2', 0)
    await expect(page.locator('.woffice-app-tb-trigger-label')).toHaveText('标题 2')
    await caret(page, '.woffice-page p', 0)
    await expect(page.locator('.woffice-app-tb-trigger-label')).toHaveText('正文')
  })

  test('正文 → 标题 1', async ({ page }) => {
    await page.goto('/?sample')
    await caret(page, '.woffice-page p', 0)
    await page.locator('.woffice-app-tb-trigger').click()
    await page.locator('.woffice-app-tb-menu-item[data-key="heading1"]').click()
    await expect(page.locator('.woffice-page h1')).toHaveText(SAMPLE_P)
  })

  test('段落 → 引用（行内容包进 paragraph）', async ({ page }) => {
    await page.goto('/?sample')
    await caret(page, '.woffice-page p', 0)
    await page.getByRole('button', { name: '引用' }).click()
    const bq = page.locator('.woffice-page > blockquote').first()
    await expect(bq).toBeVisible()
    await expect(bq.locator('p')).toHaveText(SAMPLE_P)
    await expect(page.locator('.woffice-app-tb-trigger-label')).toHaveText('引用')
  })

  test('引用 → 正文（剥掉 paragraph 包裹）', async ({ page }) => {
    await page.goto('/?sample')
    await caret(page, '.woffice-page blockquote p', 0)
    await page.locator('.woffice-app-tb-trigger').click()
    await page.locator('.woffice-app-tb-menu-item[data-key="paragraph"]').click()
    await expect(page.locator('.woffice-page > blockquote')).toHaveCount(0)
    await expect(page.locator('.woffice-page > p').filter({ hasText: SAMPLE_QUOTE })).toHaveCount(1)
  })

  test('段落 → 代码块', async ({ page }) => {
    await page.goto('/?sample')
    await caret(page, '.woffice-page p', 0)
    await page.getByRole('button', { name: '代码块' }).click()
    await expect(page.locator('.woffice-page > pre')).toHaveText(SAMPLE_P)
    await expect(page.locator('.woffice-app-tb-trigger-label')).toHaveText('代码块')
  })
})

// ---------------------------------------------------------------------------
// 列表 / 分割线
// ---------------------------------------------------------------------------

test.describe('列表与分割线', () => {
  test('段落 → 无序列表', async ({ page }) => {
    await page.goto('/?sample')
    await caret(page, '.woffice-page p', 0)
    await page.getByRole('button', { name: '无序列表 (Mod-Shift-7)' }).click()
    expect(await firstBlockTag(page)).toBe('UL')
    await expect(page.getByRole('button', { name: '无序列表 (Mod-Shift-7)' })).toHaveClass(/active/)
  })

  test('段落 → 有序列表', async ({ page }) => {
    await page.goto('/?sample')
    await caret(page, '.woffice-page p', 0)
    await page.getByRole('button', { name: '有序列表 (Mod-Shift-8)' }).click()
    expect(await firstBlockTag(page)).toBe('OL')
  })

  test('列表 → 正文（保留条目边界）', async ({ page }) => {
    await page.goto('/?sample')
    await caret(page, '.woffice-page li p', 0)
    await page.locator('.woffice-app-tb-trigger').click()
    await page.locator('.woffice-app-tb-menu-item[data-key="paragraph"]').click()
    // 3 个条目 → 3 个顶层段落，而不是合并成一个
    await expect(page.locator('.woffice-page > ul')).toHaveCount(0)
    await expect(
      page.locator('.woffice-page > p').filter({ hasText: '自研文档模型与编辑引擎' }),
    ).toHaveCount(1)
    await expect(
      page.locator('.woffice-page > p').filter({ hasText: 'docx 导入导出' }),
    ).toHaveCount(1)
    await expect(
      page.locator('.woffice-page > p').filter({ hasText: '撤销重做、修订模式' }),
    ).toHaveCount(1)
  })

  test('列表项渲染出圆点（list-style + display 正确）', async ({ page }) => {
    await page.goto('/?sample')
    const info = await page
      .locator('.woffice-page ul')
      .first()
      .evaluate((ul) => {
        const li = ul.querySelector('li')!
        const cs = getComputedStyle(li)
        return {
          ulListStyle: getComputedStyle(ul).listStyleType,
          liDisplay: cs.display,
          liListStyle: cs.listStyleType,
          liPaddingLeft: getComputedStyle(ul).paddingLeft,
        }
      })
    expect(info.ulListStyle).toBe('disc')
    expect(info.liDisplay).toBe('list-item')
    expect(info.liListStyle).toBe('disc')
    expect(info.liPaddingLeft).toBe('26px')
  })

  test('插入分割线', async ({ page }) => {
    await page.goto('/?sample')
    await caret(page, '.woffice-page p', 0)
    await page.getByRole('button', { name: '分割线' }).click()
    await expect(page.locator('.woffice-page > hr')).toHaveCount(1)
  })
})

// ---------------------------------------------------------------------------
// 编辑操作
// ---------------------------------------------------------------------------

test.describe('编辑操作', () => {
  test('输入文字', async ({ page }) => {
    await page.goto('/?sample')
    await caretEnd(page, '.woffice-page p')
    await page.keyboard.press('A')
    await expect(page.locator('.woffice-page > p').first()).toHaveText(`${SAMPLE_P}A`)
  })

  test('回车拆分段落', async ({ page }) => {
    await page.goto('/?sample')
    await caret(page, '.woffice-page p', 5)
    await page.keyboard.press('Enter')
    await expect(page.locator('.woffice-page > p').nth(0)).toHaveText('这是一份在')
    await expect(page.locator('.woffice-page > p').nth(1)).toHaveText(
      '浏览器本地编辑的文档，所有数据都不会离开你的设备。',
    )
  })

  test('引用内回车拆分', async ({ page }) => {
    await page.goto('/?sample')
    await caret(page, '.woffice-page blockquote p', 5)
    await page.keyboard.press('Enter')
    await expect(page.locator('.woffice-page blockquote p')).toHaveCount(2)
    await expect(page.locator('.woffice-page blockquote p').nth(0)).toHaveText('点击右上角')
    await expect(page.locator('.woffice-page blockquote p').nth(1)).toHaveText(
      '「导入 .docx」打开一个 Word 文件试试。',
    )
  })

  test('选中加粗后：保留选区 + 按钮高亮', async ({ page }) => {
    await page.goto('/?sample')
    await selectAll(page, '.woffice-page h2')
    await page.getByRole('button', { name: '加粗 (Mod-B)' }).click()
    await expect(page.locator('.woffice-page h2 strong')).toHaveText(SAMPLE_H2)
    await expect(page.getByRole('button', { name: '加粗 (Mod-B)' })).toHaveClass(/active/)
    const sel = await page.evaluate(() => window.getSelection()?.toString())
    expect(sel).toBe(SAMPLE_H2)
  })

  test('选中后回车：删除选区内容并拆分', async ({ page }) => {
    await page.goto('/?sample')
    await page
      .locator('.woffice-page p')
      .first()
      .evaluate((el) => {
        const t = el.firstChild as Text
        const r = document.createRange()
        r.setStart(t, 5)
        r.setEnd(t, 10)
        const s = window.getSelection()!
        s.removeAllRanges()
        s.addRange(r)
        document.dispatchEvent(new Event('selectionchange'))
      })
    await page.keyboard.press('Enter')
    // 选中 [5,10) = “浏览器本地”，删除后拆分为 “这是一份在” + “编辑…”
    await expect(page.locator('.woffice-page > p').nth(0)).toHaveText('这是一份在')
    await expect(page.locator('.woffice-page > p').nth(1)).toHaveText(
      '编辑的文档，所有数据都不会离开你的设备。',
    )
  })

  test('引用内末尾回车：在引用内继续（不脱离引用）', async ({ page }) => {
    await page.goto('/?sample')
    await caretEnd(page, '.woffice-page blockquote p')
    await page.keyboard.press('Enter')
    await expect(page.locator('.woffice-page blockquote')).toHaveCount(1)
    await expect(page.locator('.woffice-page blockquote p')).toHaveCount(2)
    // 光标仍在引用块内
    const inQuote = await page.evaluate(() => {
      const sel = window.getSelection()
      const el = sel?.anchorNode?.nodeType === 1 ? sel.anchorNode : sel?.anchorNode?.parentElement
      return !!el?.closest?.('blockquote')
    })
    expect(inQuote).toBe(true)
  })

  test('引用内连续回车：第二次回车退出引用', async ({ page }) => {
    await page.goto('/?sample')
    await caretEnd(page, '.woffice-page blockquote p')
    await page.keyboard.press('Enter') // 引用内新段落
    await page.keyboard.press('Enter') // 退出引用
    // 引用内容保留，引用外紧跟着多出一个正文段落
    await expect(page.locator('.woffice-page blockquote')).toHaveCount(1)
    await expect(page.locator('.woffice-page blockquote p')).toHaveCount(1)
    await expect(page.locator('.woffice-page blockquote + p')).toHaveCount(1)
    await expect(page.locator('.woffice-page blockquote + p')).toHaveText('')
    // 光标已落到引用块外
    const inQuote = await page.evaluate(() => {
      const sel = window.getSelection()
      const el = sel?.anchorNode?.nodeType === 1 ? sel.anchorNode : sel?.anchorNode?.parentElement
      return !!el?.closest?.('blockquote')
    })
    expect(inQuote).toBe(false)
  })

  test('引用内连续回车：退出后空段落保持高度', async ({ page }) => {
    await page.goto('/?sample')
    await caretEnd(page, '.woffice-page blockquote p')
    await page.keyboard.press('Enter') // 引用内新段落
    await page.keyboard.press('Enter') // 退出引用
    await page.keyboard.press('Enter') // 正文里再分段
    await expect(page.locator('.woffice-page blockquote')).toHaveCount(1)
    await expect(page.locator('.woffice-page blockquote + p')).toHaveCount(1)
    await expect(page.locator('.woffice-page blockquote + p + p')).toHaveCount(1)
    // 每个空段落都要有占位 <br>，否则高度为 0、光标看不见（表现为“回车失效”）
    const heights = await page
      .locator('.woffice-page blockquote + p, .woffice-page blockquote + p + p')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))
    expect(heights.every((h) => h > 0)).toBe(true)
  })

  test('列表内回车：新建同类型列表项（Word/Docs 行为）', async ({ page }) => {
    await page.goto('/?sample')
    const items = page.locator('.woffice-page li')
    await expect(items).toHaveCount(3)
    // 光标放在第一条中间 → 应拆成两条
    await caret(page, '.woffice-page li p', 2)
    await page.keyboard.press('Enter')
    await expect(items).toHaveCount(4)
    await expect(items.nth(0)).toHaveText('自研')
    await expect(items.nth(1)).toHaveText('文档模型与编辑引擎（模型 / 引擎 / 渲染分层）')
  })

  test('空列表项回车：退出列表，已写条目与编号保留', async ({ page }) => {
    await page.goto('/?sample')
    const items = page.locator('.woffice-page li')
    await expect(items).toHaveCount(3)
    // 光标放到最后一个条目末尾
    await page
      .locator('.woffice-page li')
      .last()
      .evaluate((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        let text: Text | null = null
        let node: Node | null = null
        while ((node = walker.nextNode())) text = node as Text
        const range = document.createRange()
        range.setStart(text!, text!.data.length)
        range.collapse(true)
        const sel = window.getSelection()!
        sel.removeAllRanges()
        sel.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
      })
    await page.keyboard.press('Enter') // 在最后一条后新建空项
    await expect(items).toHaveCount(4)
    await page.keyboard.press('Enter') // 空项再回车 → 退出列表
    // 列表保留，已写条目和编号不丢；列表后多出一个正文段落
    await expect(items).toHaveCount(3)
    await expect(items.nth(0)).toContainText('自研文档模型与编辑引擎')
    await expect(page.locator('.woffice-page > ul + p')).toHaveCount(1)
    await expect(page.locator('.woffice-page > ul + p')).toHaveText('')
  })

  test('有序列表 ↔ 无序列表：切换类型且保留内容', async ({ page }) => {
    await page.goto('/?sample')
    await caret(page, '.woffice-page li p', 0)
    await page.getByRole('button', { name: '有序列表 (Mod-Shift-8)' }).click()
    await expect(page.locator('.woffice-page > ol')).toHaveCount(1)
    await expect(page.locator('.woffice-page li')).toHaveCount(3)
    await expect(page.locator('.woffice-page li').first()).toContainText('自研文档模型与编辑引擎')

    await page.getByRole('button', { name: '无序列表 (Mod-Shift-7)' }).click()
    await expect(page.locator('.woffice-page > ul')).toHaveCount(1)
    await expect(page.locator('.woffice-page li')).toHaveCount(3)
    await expect(page.locator('.woffice-page li').first()).toContainText('自研文档模型与编辑引擎')
  })

  test('块首退格合并上一个块', async ({ page }) => {
    await page.goto('/?sample')
    await caret(page, '.woffice-page p >> nth=1', 0)
    await page.keyboard.press('Backspace')
    await expect(page.locator('.woffice-page > h2')).toContainText(SAMPLE_H2)
    await expect(page.locator('.woffice-page > h2')).toContainText('选中文字即可使用上方工具栏')
  })

  test('列表第一个条目退格：退出列表', async ({ page }) => {
    await page.goto('/?sample')
    await caret(page, '.woffice-page li p', 0)
    await page.keyboard.press('Backspace')
    await expect(page.locator('.woffice-page > ul > li')).toHaveCount(2)
    await expect(
      page.locator('.woffice-page > p').filter({ hasText: '自研文档模型与编辑引擎' }),
    ).toHaveCount(1)
  })

  test('列表中间条目退格：并入前一条目', async ({ page }) => {
    await page.goto('/?sample')
    await caret(page, '.woffice-page > ul > li >> nth=1 >> p', 0)
    await page.keyboard.press('Backspace')
    await expect(page.locator('.woffice-page > ul > li')).toHaveCount(2)
    await expect(page.locator('.woffice-page > ul > li').first()).toContainText(
      '自研文档模型与编辑引擎（模型 / 引擎 / 渲染分层）docx 导入导出（OOXML + zip 完全自研）',
    )
  })
})

// ---------------------------------------------------------------------------
// WPS 操作对齐
// ---------------------------------------------------------------------------

test.describe('WPS 操作对齐', () => {
  test('折叠光标处点击加粗：后续输入加粗，按钮激活', async ({ page }) => {
    await page.goto('/')
    await page.locator('.woffice-editor-content').click()
    await page.getByRole('button', { name: '加粗 (Mod-B)' }).click()
    await expect(page.getByRole('button', { name: '加粗 (Mod-B)' })).toHaveClass(/active/)
    await page.keyboard.type('abc')
    await expect(page.locator('.woffice-page strong')).toHaveText('abc')
  })

  test('连续输入合并为一个撤销单元', async ({ page }) => {
    await page.goto('/')
    await page.locator('.woffice-editor-content').click()
    await page.keyboard.type('abc')
    await expect(page.locator('.woffice-page p')).toHaveText('abc')
    await page.keyboard.press('Control+z')
    await expect(page.locator('.woffice-page p')).toBeEmpty()
  })

  test('分割线后下方可继续输入', async ({ page }) => {
    await page.goto('/')
    await page.locator('.woffice-editor-content').click()
    await page.keyboard.type('上方')
    await page.getByRole('button', { name: '分割线' }).click()
    await page.keyboard.type('下方')
    const blocks = page.locator('.woffice-page > p')
    await expect(blocks.nth(0)).toHaveText('上方')
    await expect(blocks.nth(1)).toHaveText('下方')
    await expect(page.locator('.woffice-page > hr')).toHaveCount(1)
  })

  test('Tab 缩进列表项 / Shift+Tab 取消缩进', async ({ page }) => {
    await page.goto('/')
    await page.locator('.woffice-editor-content').click()
    await page.getByRole('button', { name: '有序列表 (Mod-Shift-8)' }).click()
    await page.keyboard.type('甲')
    await page.keyboard.press('Enter')
    await page.keyboard.type('乙')
    await page.keyboard.press('Tab')
    await expect(page.locator('.woffice-page > ol > li > ol')).toHaveCount(1)
    await page.keyboard.press('Shift+Tab')
    await expect(page.locator('.woffice-page > ol > li > ol')).toHaveCount(0)
    await expect(page.locator('.woffice-page > ol > li')).toHaveCount(2)
  })

  test('标题末尾回车回到正文', async ({ page }) => {
    await page.goto('/?sample')
    await caretEnd(page, '.woffice-page h2')
    await page.keyboard.press('Enter')
    const tags = await page.locator('.woffice-editor-content').evaluate((el) =>
      Array.from(el.querySelectorAll('[data-woffice-path]'))
        .slice(0, 3)
        .map((e) => e.tagName),
    )
    expect(tags).toEqual(['P', 'H2', 'P'])
  })

  test('跨块选中后点列表：合并为一个列表', async ({ page }) => {
    await page.goto('/')
    await page.locator('.woffice-editor-content').click()
    await page.keyboard.type('甲')
    await page.keyboard.press('Enter')
    await page.keyboard.type('乙')
    await page.locator('.woffice-editor-content').evaluate((el) => {
      const ps = el.querySelectorAll('p')
      const first = ps[0].firstChild as Text
      const last = ps[1].firstChild as Text
      const range = document.createRange()
      range.setStart(first, 0)
      range.setEnd(last, last.data.length)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
    await page.getByRole('button', { name: '有序列表 (Mod-Shift-8)' }).click()
    await expect(page.locator('.woffice-page > ol > li')).toHaveCount(2)
    await expect(page.locator('.woffice-page > ol > li').nth(0)).toHaveText('甲')
    await expect(page.locator('.woffice-page > ol > li').nth(1)).toHaveText('乙')
  })

  test('嵌套列表里切换类型：只切光标所在那层', async ({ page }) => {
    await page.goto('/')
    await page.locator('.woffice-editor-content').click()
    await page.getByRole('button', { name: '有序列表 (Mod-Shift-8)' }).click()
    await page.keyboard.type('甲')
    await page.keyboard.press('Enter')
    await page.keyboard.type('乙')
    await page.keyboard.press('Tab')
    await page.getByRole('button', { name: '无序列表 (Mod-Shift-7)' }).click()
    await expect(page.locator('.woffice-page > ol > li > ul')).toHaveCount(1)
    await expect(page.locator('.woffice-page > ol > li > ul > li')).toHaveText('乙')
  })
})

// ---------------------------------------------------------------------------
// 回车两次退出（已写内容必须保留）
// ---------------------------------------------------------------------------

test.describe('回车两次退出', () => {
  test('无序列表：退出后条目与圆点保留', async ({ page }) => {
    await page.goto('/')
    await page.locator('.woffice-editor-content').click()
    await page.getByRole('button', { name: '无序列表 (Mod-Shift-7)' }).click()
    await page.keyboard.type('甲')
    await page.keyboard.press('Enter')
    await page.keyboard.type('乙')
    await page.keyboard.press('Enter') // 空项
    await page.keyboard.press('Enter') // 退出列表
    // 列表本身保留，已写条目和圆点不丢
    await expect(page.locator('.woffice-page > ul')).toHaveCount(1)
    const items = page.locator('.woffice-page > ul > li')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toHaveText('甲')
    await expect(items.nth(1)).toHaveText('乙')
    // 列表后面多出一个正文段落，光标在那里
    await expect(page.locator('.woffice-page > ul + p')).toHaveCount(1)
    await expect(page.locator('.woffice-page > ul + p')).toHaveText('')
  })

  test('有序列表：退出后条目与编号保留', async ({ page }) => {
    await page.goto('/')
    await page.locator('.woffice-editor-content').click()
    await page.getByRole('button', { name: '有序列表 (Mod-Shift-8)' }).click()
    await page.keyboard.type('甲')
    await page.keyboard.press('Enter')
    await page.keyboard.type('乙')
    await page.keyboard.press('Enter') // 空项
    await page.keyboard.press('Enter') // 退出列表
    await expect(page.locator('.woffice-page > ol')).toHaveCount(1)
    const items = page.locator('.woffice-page > ol > li')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toHaveText('甲')
    await expect(items.nth(1)).toHaveText('乙')
    await expect(page.locator('.woffice-page > ol + p')).toHaveCount(1)
    await expect(page.locator('.woffice-page > ol + p')).toHaveText('')
  })

  test('引用：退出后引用内容保留', async ({ page }) => {
    await page.goto('/')
    await page.locator('.woffice-editor-content').click()
    await page.getByRole('button', { name: '引用' }).click()
    await page.keyboard.type('甲')
    await page.keyboard.press('Enter') // 引用内新段落
    await page.keyboard.press('Enter') // 退出引用
    await expect(page.locator('.woffice-page > blockquote')).toHaveCount(1)
    await expect(page.locator('.woffice-page > blockquote p')).toHaveText('甲')
    await expect(page.locator('.woffice-page > p')).toHaveCount(1)
    await expect(page.locator('.woffice-page > p')).toHaveText('')
  })

  test('代码块内回车：块内换行，外观是一个整体', async ({ page }) => {
    await page.goto('/')
    await page.locator('.woffice-editor-content').click()
    await page.getByRole('button', { name: '代码块' }).click()
    await page.keyboard.type('甲')
    await page.keyboard.press('Enter')
    await page.keyboard.type('乙')
    // 仍然是一个 <pre>，内容换行但不拆成两张卡片
    await expect(page.locator('.woffice-page > pre')).toHaveCount(1)
    const text = await page.locator('.woffice-page > pre').evaluate((el) => el.textContent)
    expect(text).toBe('甲\n乙')
  })

  test('代码块退出后再点代码块：相邻代码块合并为一个整体', async ({ page }) => {
    await page.goto('/')
    await page.locator('.woffice-editor-content').click()
    const codeBtn = page.locator('button[title="代码块"]')
    await codeBtn.click()
    await page.keyboard.type('第一行')
    await page.keyboard.press('Enter') // 换行
    await page.keyboard.press('Enter') // 连续第二次 → 退出
    await page.keyboard.type('第二段')
    await codeBtn.click() // 再点代码块，应合并成同一个 <pre>
    await expect(page.locator('.woffice-page > pre')).toHaveCount(1)
    const text = await page.locator('.woffice-page > pre').evaluate((el) => el.textContent)
    expect(text).toBe('第一行\n第二段')
  })

  test('代码块：连续两次回车退出，代码内容保留', async ({ page }) => {
    await page.goto('/')
    await page.locator('.woffice-editor-content').click()
    await page.locator('button[title="代码块"]').click()
    await page.keyboard.type('甲')
    await page.keyboard.press('Enter') // 块内换行
    await page.keyboard.press('Enter') // 连续第二次回车 → 退出
    await expect(page.locator('.woffice-page > pre')).toHaveCount(1)
    await expect(page.locator('.woffice-page > pre')).toHaveText('甲')
    await expect(page.locator('.woffice-page > p')).toHaveCount(1)
    await expect(page.locator('.woffice-page > p')).toHaveText('')
  })
})

// ---------------------------------------------------------------------------
// 历史 / 修订 / 视图 / 文档
// ---------------------------------------------------------------------------

test.describe('历史与视图', () => {
  test('撤销 / 重做', async ({ page }) => {
    await page.goto('/?sample')
    await selectAll(page, '.woffice-page h2')
    await page.getByRole('button', { name: '加粗 (Mod-B)' }).click()
    await expect(page.locator('.woffice-page h2 strong')).toHaveCount(1)

    await page.getByRole('button', { name: '撤销 (Mod-Z)' }).click()
    await expect(page.locator('.woffice-page h2 strong')).toHaveCount(0)

    await page.getByRole('button', { name: '重做 (Mod-Y)' }).click()
    await expect(page.locator('.woffice-page h2 strong')).toHaveCount(1)
  })

  test('快捷键 Ctrl+B', async ({ page }) => {
    await page.goto('/?sample')
    await selectAll(page, '.woffice-page h2')
    await page.keyboard.press('Control+b')
    await expect(page.locator('.woffice-page h2 strong')).toHaveCount(1)
  })

  test('修订模式下输入带 track_insert', async ({ page }) => {
    await page.goto('/?sample')
    await caretEnd(page, '.woffice-page p')
    await page.getByRole('button', { name: /修订模式/ }).click()
    await page.keyboard.press('B')
    await expect(page.locator('.woffice-page p .woffice-mark-track-insert')).toHaveText('B')
  })

  test('切换流式视图', async ({ page }) => {
    await page.goto('/?sample')
    await page.getByRole('tab', { name: '流式视图' }).click()
    await expect(page.locator('.woffice-page')).toHaveCount(0)
    await expect(page.locator('.woffice-editor-content')).not.toHaveClass(/view-page/)
    await expect(page.locator('.woffice-app-status-item').nth(0)).toHaveText('流式布局')
  })

  test('标题输入', async ({ page }) => {
    await page.goto('/?sample')
    await page.locator('.woffice-app-title').fill('我的文档')
    await expect(page.locator('.woffice-app-title')).toHaveValue('我的文档')
  })

  test('导出 .docx', async ({ page }) => {
    await page.goto('/?sample')
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '导出 .docx' }).click(),
    ])
    // 文件名取顶栏标题（demo 默认标题为“欢迎使用 woffice”）
    expect(download.suggestedFilename()).toBe('欢迎使用 woffice.docx')
  })

  test('导入 .docx', async ({ page }) => {
    await page.goto('/?sample')
    await page.locator('input[type="file"]').setInputFiles('test/fixtures/rich.docx')
    await expect(page.locator('.woffice-app-title')).toHaveValue('rich')
    await expect(page.locator('.woffice-page h2')).toHaveText('季度报告')
    await expect(page.locator('.woffice-page table')).toHaveCount(1)
  })
})

// ---------------------------------------------------------------------------
// 空白文档（默认 demo 状态）
// ---------------------------------------------------------------------------

test.describe('空白文档', () => {
  test('空段落有占位 <br>（否则高度为 0、光标不可见）', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.woffice-page p br')).toHaveCount(1)
    const height = await page
      .locator('.woffice-page p')
      .evaluate((el) => el.getBoundingClientRect().height)
    expect(height).toBeGreaterThan(0)
  })

  test('初始光标在首行、画布停在顶部', async ({ page }) => {
    await page.goto('/')
    const scrollTop = await page.locator('.woffice-app-canvas').evaluate((el) => el.scrollTop)
    expect(scrollTop).toBe(0)
  })

  test('页码不可编辑、不可选中', async ({ page }) => {
    await page.goto('/?sample')
    const number = page.locator('.woffice-page-number').first()
    await expect(number).toHaveAttribute('contenteditable', 'false')
    const pointerEvents = await number.evaluate((el) => getComputedStyle(el).pointerEvents)
    expect(pointerEvents).toBe('none')
  })

  test('页面高度固定（A4），内容分页而不撑高页面', async ({ page }) => {
    await page.goto('/')
    await page.click('.woffice-page p')
    for (let i = 0; i < 50; i++) {
      await page.keyboard.type('段落' + i)
      await page.keyboard.press('Enter')
    }
    const heights = await page
      .locator('.woffice-page')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
    expect(heights.length).toBeGreaterThan(1)
    for (const h of heights) expect(h).toBe(1123)
  })

  test('空段落内 IME 输入能写进模型', async ({ page }) => {
    await page.goto('/')
    await page.click('.woffice-page p')
    await page.evaluate(() => {
      const content = document.querySelector('.woffice-editor-content')
      const p = document.querySelector('.woffice-page p')
      content.focus()
      const r = document.createRange()
      r.setStart(p, 0)
      r.collapse(true)
      const s = window.getSelection()!
      s.removeAllRanges()
      s.addRange(r)
      content.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      p.appendChild(document.createTextNode('撒地方'))
      content.dispatchEvent(
        new CompositionEvent('compositionend', { bubbles: true, data: '撒地方' }),
      )
    })
    await expect(page.locator('.woffice-page p')).toHaveText('撒地方')
    // 组合文本必须已进模型，否则下一次渲染会把它抹掉
    await page.keyboard.press('X')
    await expect(page.locator('.woffice-page p')).toHaveText('撒地方X')
  })

  test('未命名时禁止导出，命名后允许', async ({ page }) => {
    await page.goto('/')
    const exportBtn = page.getByRole('button', { name: '导出 .docx' })
    await expect(exportBtn).toBeDisabled()

    await page.locator('.woffice-app-title').fill('我的文档')
    await expect(exportBtn).toBeEnabled()
  })
})
