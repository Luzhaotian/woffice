import { describe, expect, it } from 'vitest'
import type { Document } from '@/model/node'
import { createDocument, createElement, createText } from '@/model/node'
import { normalize } from '@/model/normalize'
import type { Step } from '@/engine/step'
import {
  deleteBackward,
  deleteForward,
  deleteRange,
  indentListItem,
  insertTextAt,
  outdentListItem,
  setBlockType,
  splitBlock,
  splitListItem,
  toggleListBlocks,
  toggleMark,
  unwrapFromList,
  wrapInList,
} from '@/engine/commands'

function applySteps(doc: Document, steps: Step[]): Document {
  let result = doc
  for (const step of steps) result = step.apply(result)
  return normalize(result)
}

describe('insertTextAt', () => {
  it('文本节点内插入', () => {
    const doc = createDocument([createElement('paragraph', [createText('ac')])])
    const { steps, caret } = insertTextAt(doc, { path: [0, 0], offset: 1 }, 'b')
    expect(applySteps(doc, steps)).toEqual(
      createDocument([createElement('paragraph', [createText('abc')])]),
    )
    expect(caret).toEqual({ path: [0, 0], offset: 2 })
  })

  it('空段落（元素路径）插入', () => {
    const doc = createDocument([createElement('paragraph')])
    const { steps, caret } = insertTextAt(doc, { path: [0], offset: 0 }, 'x')
    expect(applySteps(doc, steps)).toEqual(
      createDocument([createElement('paragraph', [createText('x')])]),
    )
    expect(caret).toEqual({ path: [0, 0], offset: 1 })
  })

  it('显式空 marks：在加粗文本末尾插入无格式文字', () => {
    const doc = createDocument([
      createElement('paragraph', [createText('abc', [{ type: 'bold' }])]),
    ])
    const { steps, caret } = insertTextAt(doc, { path: [0, 0], offset: 3 }, 'd', [])
    expect(applySteps(doc, steps)).toEqual(
      createDocument([
        createElement('paragraph', [createText('abc', [{ type: 'bold' }]), createText('d')]),
      ]),
    )
    expect(caret).toEqual({ path: [0, 1], offset: 1 })
  })
})

describe('deleteRange', () => {
  it('同一文本节点内删除', () => {
    const doc = createDocument([createElement('paragraph', [createText('abc')])])
    expect(
      applySteps(doc, deleteRange(doc, { path: [0, 0], offset: 1 }, { path: [0, 0], offset: 3 })),
    ).toEqual(createDocument([createElement('paragraph', [createText('a')])]))
  })

  it('同一块内跨文本节点删除', () => {
    const doc = createDocument([
      createElement('paragraph', [createText('ab', [{ type: 'bold' }]), createText('c')]),
    ])
    expect(
      applySteps(doc, deleteRange(doc, { path: [0, 0], offset: 1 }, { path: [0, 1], offset: 1 })),
    ).toEqual(createDocument([createElement('paragraph', [createText('a', [{ type: 'bold' }])])]))
  })

  it('选区起点落在文本节点末尾：保留该节点前半段', () => {
    const doc = createDocument([
      createElement('paragraph', [
        createText('h'),
        createText('ello wo', [{ type: 'bold' }]),
        createText('rld'),
      ]),
    ])
    const result = applySteps(
      doc,
      deleteRange(doc, { path: [0, 0], offset: 1 }, { path: [0, 1], offset: 7 }),
    )
    // 删除后相邻同 marks 文本会被 normalize 合并
    expect(result).toEqual(createDocument([createElement('paragraph', [createText('hrld')])]))
  })

  it('跨块删除并合并', () => {
    const doc = createDocument([
      createElement('paragraph', [createText('ab')]),
      createElement('paragraph', [createText('cd')]),
    ])
    const result = applySteps(
      doc,
      deleteRange(doc, { path: [0, 0], offset: 1 }, { path: [1, 0], offset: 1 }),
    )
    expect(result).toEqual(createDocument([createElement('paragraph', [createText('ad')])]))
  })

  it('跨块删除可逆（步骤往返）', () => {
    const doc = createDocument([
      createElement('paragraph', [createText('ab')]),
      createElement('paragraph', [createText('cd')]),
    ])
    const steps = deleteRange(doc, { path: [0, 0], offset: 1 }, { path: [1, 0], offset: 1 })
    let working = doc
    for (const step of steps) working = step.apply(working)
    for (const step of [...steps].reverse()) working = step.invert().apply(working)
    expect(working).toEqual(doc)
  })
})

describe('deleteBackward / deleteForward', () => {
  it('文本内退格', () => {
    const doc = createDocument([createElement('paragraph', [createText('abc')])])
    expect(applySteps(doc, deleteBackward(doc, { path: [0, 0], offset: 1 }))).toEqual(
      createDocument([createElement('paragraph', [createText('bc')])]),
    )
  })

  it('块首退格合并上一个块', () => {
    const doc = createDocument([
      createElement('paragraph', [createText('ab')]),
      createElement('paragraph', [createText('cd')]),
    ])
    expect(applySteps(doc, deleteBackward(doc, { path: [1, 0], offset: 0 }))).toEqual(
      createDocument([createElement('paragraph', [createText('abcd')])]),
    )
  })

  it('列表第一个条目开头退格：退出列表', () => {
    const doc = createDocument([
      createElement('paragraph', [createText('a')]),
      createElement('bullet_list', [
        createElement('list_item', [createElement('paragraph', [createText('b')])]),
      ]),
    ])
    const result = applySteps(doc, deleteBackward(doc, { path: [1, 0, 0, 0], offset: 0 }))
    expect(result.children).toEqual([
      createElement('paragraph', [createText('a')]),
      createElement('paragraph', [createText('b')]),
    ])
  })

  it('列表中间条目开头退格：并入前一条目', () => {
    const doc = createDocument([
      createElement('bullet_list', [
        createElement('list_item', [createElement('paragraph', [createText('a')])]),
        createElement('list_item', [createElement('paragraph', [createText('b')])]),
      ]),
    ])
    const result = applySteps(doc, deleteBackward(doc, { path: [0, 1, 0, 0], offset: 0 }))
    expect(result.children).toEqual([
      createElement('bullet_list', [
        createElement('list_item', [createElement('paragraph', [createText('ab')])]),
      ]),
    ])
  })

  it('引用第一个段落开头退格：退出引用', () => {
    const doc = createDocument([
      createElement('paragraph', [createText('a')]),
      createElement('blockquote', [createElement('paragraph', [createText('b')])]),
    ])
    const result = applySteps(doc, deleteBackward(doc, { path: [1, 0, 0], offset: 0 }))
    expect(result.children).toEqual([
      createElement('paragraph', [createText('a')]),
      createElement('paragraph', [createText('b')]),
    ])
  })

  it('文本内向前删除', () => {
    const doc = createDocument([createElement('paragraph', [createText('abc')])])
    expect(applySteps(doc, deleteForward(doc, { path: [0, 0], offset: 0 }))).toEqual(
      createDocument([createElement('paragraph', [createText('bc')])]),
    )
  })

  it('块尾向前删除合并下一个块', () => {
    const doc = createDocument([
      createElement('paragraph', [createText('ab')]),
      createElement('paragraph', [createText('cd')]),
    ])
    expect(applySteps(doc, deleteForward(doc, { path: [0, 0], offset: 2 }))).toEqual(
      createDocument([createElement('paragraph', [createText('abcd')])]),
    )
  })

  it('选区删除', () => {
    const doc = createDocument([createElement('paragraph', [createText('abc')])])
    expect(
      applySteps(
        doc,
        deleteBackward(doc, { path: [0, 0], offset: 1 }, { path: [0, 0], offset: 3 }),
      ),
    ).toEqual(createDocument([createElement('paragraph', [createText('a')])]))
  })
})

describe('splitBlock', () => {
  it('文本中间拆分', () => {
    const doc = createDocument([createElement('paragraph', [createText('abc')])])
    const { steps, caret } = splitBlock(doc, { path: [0, 0], offset: 1 })
    expect(applySteps(doc, steps)).toEqual(
      createDocument([
        createElement('paragraph', [createText('a')]),
        createElement('paragraph', [createText('bc')]),
      ]),
    )
    expect(caret).toEqual({ path: [1, 0], offset: 0 })
  })

  it('嵌套块内拆分（引用里的段落）', () => {
    const doc = createDocument([
      createElement('blockquote', [createElement('paragraph', [createText('abcd')])]),
    ])
    const { steps, caret } = splitBlock(doc, { path: [0, 0, 0], offset: 2 })
    expect(applySteps(doc, steps)).toEqual(
      createDocument([
        createElement('blockquote', [
          createElement('paragraph', [createText('ab')]),
          createElement('paragraph', [createText('cd')]),
        ]),
      ]),
    )
    expect(caret).toEqual({ path: [0, 1, 0], offset: 0 })
  })

  it('列表项内拆分', () => {
    const doc = createDocument([
      createElement('bullet_list', [
        createElement('list_item', [createElement('paragraph', [createText('abcd')])]),
      ]),
    ])
    const { steps, caret } = splitBlock(doc, { path: [0, 0, 0, 0], offset: 1 })
    expect(applySteps(doc, steps)).toEqual(
      createDocument([
        createElement('bullet_list', [
          createElement('list_item', [
            createElement('paragraph', [createText('a')]),
            createElement('paragraph', [createText('bcd')]),
          ]),
        ]),
      ]),
    )
    expect(caret).toEqual({ path: [0, 0, 1, 0], offset: 0 })
  })

  it('引用末尾回车：在引用内新增段落（不脱离引用）', () => {
    const doc = createDocument([
      createElement('blockquote', [createElement('paragraph', [createText('abc')])]),
    ])
    const { steps, caret } = splitBlock(doc, { path: [0, 0, 0], offset: 3 })
    expect(applySteps(doc, steps)).toEqual(
      createDocument([
        createElement('blockquote', [
          createElement('paragraph', [createText('abc')]),
          createElement('paragraph'),
        ]),
      ]),
    )
    expect(caret).toEqual({ path: [0, 1, 0], offset: 0 })
  })

  it('引用里的空段落回车：退出引用，不新建容器', () => {
    const doc = createDocument([
      createElement('blockquote', [
        createElement('paragraph', [createText('abc')]),
        createElement('paragraph'),
      ]),
    ])
    const { steps, caret } = splitBlock(doc, { path: [0, 1], offset: 0 })
    expect(applySteps(doc, steps)).toEqual(
      createDocument([
        createElement('blockquote', [createElement('paragraph', [createText('abc')])]),
        createElement('paragraph'),
      ]),
    )
    expect(caret).toEqual({ path: [1], offset: 0 })
  })

  it('列表空条目内回车：在列表项内继续', () => {
    const doc = createDocument([
      createElement('bullet_list', [
        createElement('list_item', [createElement('paragraph', [createText('abc')])]),
        createElement('list_item', [createElement('paragraph')]),
      ]),
    ])
    const { steps, caret } = splitBlock(doc, { path: [0, 1, 0], offset: 0 })
    expect(applySteps(doc, steps)).toEqual(
      createDocument([
        createElement('bullet_list', [
          createElement('list_item', [createElement('paragraph', [createText('abc')])]),
          createElement('list_item', [createElement('paragraph'), createElement('paragraph')]),
        ]),
      ]),
    )
    expect(caret).toEqual({ path: [0, 1, 1], offset: 0 })
  })

  it('列表项内拆分：新建同类型列表项', () => {
    const doc = createDocument([
      createElement('bullet_list', [
        createElement('list_item', [createElement('paragraph', [createText('abcd')])]),
      ]),
    ])
    const { steps, caret } = splitListItem(doc, { path: [0, 0, 0, 0], offset: 2 })!
    expect(applySteps(doc, steps)).toEqual(
      createDocument([
        createElement('bullet_list', [
          createElement('list_item', [createElement('paragraph', [createText('ab')])]),
          createElement('list_item', [createElement('paragraph', [createText('cd')])]),
        ]),
      ]),
    )
    expect(caret).toEqual({ path: [0, 1, 0, 0], offset: 0 })
  })

  it('空列表项拆分：退出列表，已写条目与列表保留', () => {
    const doc = createDocument([
      createElement('bullet_list', [
        createElement('list_item', [createElement('paragraph', [createText('ab')])]),
        createElement('list_item', [createElement('paragraph')]),
      ]),
    ])
    const { steps, caret } = splitListItem(doc, { path: [0, 1, 0], offset: 0 })!
    expect(applySteps(doc, steps)).toEqual(
      createDocument([
        createElement('bullet_list', [
          createElement('list_item', [createElement('paragraph', [createText('ab')])]),
        ]),
        createElement('paragraph'),
      ]),
    )
    expect(caret).toEqual({ path: [1], offset: 0 })
  })

  it('文本末尾拆分出空块', () => {
    const doc = createDocument([createElement('paragraph', [createText('abc')])])
    const { steps } = splitBlock(doc, { path: [0, 0], offset: 3 })
    expect(applySteps(doc, steps)).toEqual(
      createDocument([createElement('paragraph', [createText('abc')]), createElement('paragraph')]),
    )
  })

  it('标题末尾回车：新块回到正文（Word/WPS）', () => {
    const doc = createDocument([createElement('heading', [createText('标题')], { level: 2 })])
    const { steps, caret } = splitBlock(doc, { path: [0, 0], offset: 2 })
    expect(applySteps(doc, steps)).toEqual(
      createDocument([
        createElement('heading', [createText('标题')], { level: 2 }),
        createElement('paragraph'),
      ]),
    )
    expect(caret).toEqual({ path: [1, 0], offset: 0 })
  })

  it('空引用里回车：整个引用变成正文段落', () => {
    const doc = createDocument([createElement('blockquote', [createElement('paragraph')])])
    const { steps, caret } = splitBlock(doc, { path: [0, 0], offset: 0 })
    expect(applySteps(doc, steps)).toEqual(createDocument([createElement('paragraph')]))
    expect(caret).toEqual({ path: [0], offset: 0 })
  })

  it('代码块内回车：块内换行，不拆成新块', () => {
    const doc = createDocument([createElement('code_block', [createText('甲')])])
    const { steps, caret } = splitBlock(doc, { path: [0, 0], offset: 1 })
    expect(applySteps(doc, steps)).toEqual(
      createDocument([createElement('code_block', [createText('甲\n')])]),
    )
    expect(caret).toEqual({ path: [0, 0], offset: 2 })
  })

  it('光标在代码块元素位置回车：内容不丢，块内换行', () => {
    const doc = createDocument([createElement('code_block', [createText('甲')])])
    const { steps, caret } = splitBlock(doc, { path: [0], offset: 1 })
    expect(applySteps(doc, steps)).toEqual(
      createDocument([createElement('code_block', [createText('甲\n')])]),
    )
    expect(caret).toEqual({ path: [0, 0], offset: 2 })
  })

  it('代码块内空行回车：连续第二次回车退出，代码内容保留', () => {
    const doc = createDocument([createElement('code_block', [createText('甲\n')])])
    // allowCodeBlockExit = true 表示这是"连续第二次回车"
    const { steps, caret } = splitBlock(doc, { path: [0, 0], offset: 2 }, true)
    expect(applySteps(doc, steps)).toEqual(
      createDocument([createElement('code_block', [createText('甲')]), createElement('paragraph')]),
    )
    expect(caret).toEqual({ path: [1], offset: 0 })
  })

  it('代码块内空行单次回车：仍块内换行（不退出）', () => {
    const doc = createDocument([createElement('code_block', [createText('甲\n')])])
    const { steps, caret } = splitBlock(doc, { path: [0, 0], offset: 2 })
    expect(applySteps(doc, steps)).toEqual(
      createDocument([createElement('code_block', [createText('甲\n\n')])]),
    )
    expect(caret).toEqual({ path: [0, 0], offset: 3 })
  })

  it('空代码块回车：变成正文段落', () => {
    const doc = createDocument([createElement('code_block')])
    const { steps, caret } = splitBlock(doc, { path: [0], offset: 0 })
    expect(applySteps(doc, steps)).toEqual(createDocument([createElement('paragraph')]))
    expect(caret).toEqual({ path: [0], offset: 0 })
  })

  it('列表空项退出：已写条目与编号保留，列表不拆', () => {
    const doc = createDocument([
      createElement('ordered_list', [
        createElement('list_item', [createElement('paragraph', [createText('甲')])]),
        createElement('list_item', [createElement('paragraph', [createText('乙')])]),
        createElement('list_item', [createElement('paragraph')]),
      ]),
    ])
    const { steps, caret } = splitListItem(doc, { path: [0, 2, 0], offset: 0 })!
    expect(applySteps(doc, steps)).toEqual(
      createDocument([
        createElement('ordered_list', [
          createElement('list_item', [createElement('paragraph', [createText('甲')])]),
          createElement('list_item', [createElement('paragraph', [createText('乙')])]),
        ]),
        createElement('paragraph'),
      ]),
    )
    expect(caret).toEqual({ path: [1], offset: 0 })
  })

  it('空列表项是第一个 / 唯一项：整个列表变成正文段落', () => {
    const doc = createDocument([
      createElement('bullet_list', [createElement('list_item', [createElement('paragraph')])]),
    ])
    const { steps } = splitListItem(doc, { path: [0, 0, 0], offset: 0 })!
    expect(applySteps(doc, steps)).toEqual(createDocument([createElement('paragraph')]))
  })

  it('标题中间回车：仍拆成标题', () => {
    const doc = createDocument([createElement('heading', [createText('标题')], { level: 2 })])
    const { steps } = splitBlock(doc, { path: [0, 0], offset: 1 })
    expect(applySteps(doc, steps)).toEqual(
      createDocument([
        createElement('heading', [createText('标')], { level: 2 }),
        createElement('heading', [createText('题')], { level: 2 }),
      ]),
    )
  })

  it('拆分可逆', () => {
    const doc = createDocument([createElement('paragraph', [createText('abc')])])
    const { steps } = splitBlock(doc, { path: [0, 0], offset: 1 })
    let working = doc
    for (const step of steps) working = step.apply(working)
    for (const step of [...steps].reverse()) working = step.invert().apply(working)
    expect(working).toEqual(doc)
  })
})

describe('列表缩进（Tab / Shift+Tab）', () => {
  function makeList() {
    return createDocument([
      createElement('bullet_list', [
        createElement('list_item', [createElement('paragraph', [createText('甲')])]),
        createElement('list_item', [createElement('paragraph', [createText('乙')])]),
      ]),
    ])
  }

  it('Tab：把当前条目嵌套到前一个条目下', () => {
    const doc = makeList()
    const result = indentListItem(doc, { path: [0, 1, 0, 0, 0], offset: 1 })!
    expect(result).toBeDefined()
    expect(applySteps(doc, result.steps)).toEqual(
      createDocument([
        createElement('bullet_list', [
          createElement('list_item', [
            createElement('paragraph', [createText('甲')]),
            createElement('bullet_list', [
              createElement('list_item', [createElement('paragraph', [createText('乙')])]),
            ]),
          ]),
        ]),
      ]),
    )
    expect(result.caret).toEqual({ path: [0, 0, 1, 0, 0, 0], offset: 1 })
  })

  it('第一个条目没有前驱：不处理', () => {
    const doc = makeList()
    expect(indentListItem(doc, { path: [0, 0, 0, 0, 0], offset: 0 })).toBeUndefined()
  })

  it('Shift+Tab：把嵌套条目提升回外层列表', () => {
    const doc = createDocument([
      createElement('bullet_list', [
        createElement('list_item', [
          createElement('paragraph', [createText('甲')]),
          createElement('bullet_list', [
            createElement('list_item', [createElement('paragraph', [createText('乙')])]),
          ]),
        ]),
      ]),
    ])
    const result = outdentListItem(doc, { path: [0, 0, 1, 0, 0, 0], offset: 1 })!
    expect(result).toBeDefined()
    expect(applySteps(doc, result.steps)).toEqual(makeList())
    expect(result.caret).toEqual({ path: [0, 1, 0, 0], offset: 1 })
  })

  it('最外层列表取消缩进：不处理', () => {
    const doc = makeList()
    expect(outdentListItem(doc, { path: [0, 1, 0, 0, 0], offset: 0 })).toBeUndefined()
  })

  it('缩进 / 取消缩进可逆', () => {
    const doc = makeList()
    const indent = indentListItem(doc, { path: [0, 1, 0, 0, 0], offset: 1 })!
    let working = doc
    for (const step of indent.steps) working = step.apply(working)
    for (const step of [...indent.steps].reverse()) working = step.invert().apply(working)
    expect(working).toEqual(doc)
  })
})

describe('列表切换（多块 / 嵌套）', () => {
  it('跨块选区：多个段落合并为一个列表', () => {
    const doc = createDocument([
      createElement('paragraph', [createText('a')]),
      createElement('paragraph', [createText('b')]),
    ])
    expect(applySteps(doc, toggleListBlocks(doc, 0, 1, 'ordered_list'))).toEqual(
      createDocument([
        createElement('ordered_list', [
          createElement('list_item', [createElement('paragraph', [createText('a')])]),
          createElement('list_item', [createElement('paragraph', [createText('b')])]),
        ]),
      ]),
    )
  })

  it('跨块选区：都是同类型列表时全部退出列表', () => {
    const doc = createDocument([
      createElement('bullet_list', [
        createElement('list_item', [createElement('paragraph', [createText('a')])]),
      ]),
      createElement('bullet_list', [
        createElement('list_item', [createElement('paragraph', [createText('b')])]),
      ]),
    ])
    expect(applySteps(doc, toggleListBlocks(doc, 0, 1, 'bullet_list'))).toEqual(
      createDocument([
        createElement('paragraph', [createText('a')]),
        createElement('paragraph', [createText('b')]),
      ]),
    )
  })

  it('setBlockType 支持嵌套路径：只切光标所在那层列表', () => {
    const doc = createDocument([
      createElement('ordered_list', [
        createElement('list_item', [
          createElement('paragraph', [createText('甲')]),
          createElement('ordered_list', [
            createElement('list_item', [createElement('paragraph', [createText('乙')])]),
          ]),
        ]),
      ]),
    ])
    const result = applySteps(doc, setBlockType(doc, [0, 0, 1], 'bullet_list'))
    expect(result).toEqual(
      createDocument([
        createElement('ordered_list', [
          createElement('list_item', [
            createElement('paragraph', [createText('甲')]),
            createElement('bullet_list', [
              createElement('list_item', [createElement('paragraph', [createText('乙')])]),
            ]),
          ]),
        ]),
      ]),
    )
  })
})

describe('toggleMark', () => {
  it('整个文本节点加粗', () => {
    const doc = createDocument([createElement('paragraph', [createText('abc')])])
    const result = applySteps(
      doc,
      toggleMark(doc, { path: [0, 0], offset: 0 }, { path: [0, 0], offset: 3 }, 'bold'),
    )
    expect(result).toEqual(
      createDocument([createElement('paragraph', [createText('abc', [{ type: 'bold' }])])]),
    )
  })

  it('部分文本加粗（自动拆分）', () => {
    const doc = createDocument([createElement('paragraph', [createText('abc')])])
    const result = applySteps(
      doc,
      toggleMark(doc, { path: [0, 0], offset: 1 }, { path: [0, 0], offset: 2 }, 'bold'),
    )
    expect(result).toEqual(
      createDocument([
        createElement('paragraph', [
          createText('a'),
          createText('b', [{ type: 'bold' }]),
          createText('c'),
        ]),
      ]),
    )
  })

  it('跨文本节点加粗', () => {
    const doc = createDocument([createElement('paragraph', [createText('ab'), createText('cd')])])
    const result = applySteps(
      doc,
      toggleMark(doc, { path: [0, 0], offset: 1 }, { path: [0, 1], offset: 1 }, 'bold'),
    )
    expect(result).toEqual(
      createDocument([
        createElement('paragraph', [
          createText('a'),
          // b 和 c 都被加粗且相邻，normalize 会合并
          createText('bc', [{ type: 'bold' }]),
          createText('d'),
        ]),
      ]),
    )
  })

  it('再次切换取消加粗', () => {
    const doc = createDocument([
      createElement('paragraph', [createText('abc', [{ type: 'bold' }])]),
    ])
    const result = applySteps(
      doc,
      toggleMark(doc, { path: [0, 0], offset: 0 }, { path: [0, 0], offset: 3 }, 'bold'),
    )
    expect(result).toEqual(createDocument([createElement('paragraph', [createText('abc')])]))
  })

  it('范围加粗可逆', () => {
    const doc = createDocument([createElement('paragraph', [createText('ab'), createText('cd')])])
    const steps = toggleMark(doc, { path: [0, 0], offset: 1 }, { path: [0, 1], offset: 1 }, 'bold')
    let working = doc
    for (const step of steps) working = step.apply(working)
    for (const step of [...steps].reverse()) working = step.invert().apply(working)
    expect(working).toEqual(doc)
  })
})

describe('块级命令', () => {
  it('段落转标题', () => {
    const doc = createDocument([createElement('paragraph', [createText('t')])])
    const result = applySteps(doc, setBlockType(doc, [0], 'heading', { level: 2 }))
    expect(result.children[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } })
  })

  it('段落转引用：行内容包进 paragraph', () => {
    const doc = createDocument([createElement('paragraph', [createText('quote')])])
    const result = applySteps(doc, setBlockType(doc, [0], 'blockquote'))
    expect(result.children[0]).toEqual(
      createElement('blockquote', [createElement('paragraph', [createText('quote')])]),
    )
  })

  it('引用转段落：剥掉 paragraph 包裹', () => {
    const doc = createDocument([
      createElement('blockquote', [createElement('paragraph', [createText('quote')])]),
    ])
    const result = applySteps(doc, setBlockType(doc, [0], 'paragraph'))
    expect(result.children[0]).toEqual(createElement('paragraph', [createText('quote')]))
  })

  it('列表转段落：剥掉 list_item', () => {
    const doc = createDocument([
      createElement('bullet_list', [
        createElement('list_item', [createElement('paragraph', [createText('item')])]),
      ]),
    ])
    const result = applySteps(doc, setBlockType(doc, [0], 'paragraph'))
    expect(result.children[0]).toEqual(createElement('paragraph', [createText('item')]))
  })

  it('多条目列表转段落：每个条目成为独立段落', () => {
    const doc = createDocument([
      createElement('bullet_list', [
        createElement('list_item', [createElement('paragraph', [createText('a')])]),
        createElement('list_item', [createElement('paragraph', [createText('b')])]),
      ]),
    ])
    const result = applySteps(doc, setBlockType(doc, [0], 'paragraph'))
    expect(result.children).toEqual([
      createElement('paragraph', [createText('a')]),
      createElement('paragraph', [createText('b')]),
    ])
  })

  it('段落转列表：包成 list_item', () => {
    const doc = createDocument([createElement('paragraph', [createText('item')])])
    const result = applySteps(doc, setBlockType(doc, [0], 'bullet_list'))
    expect(result.children[0]).toEqual(
      createElement('bullet_list', [
        createElement('list_item', [createElement('paragraph', [createText('item')])]),
      ]),
    )
  })

  it('包进列表', () => {
    const doc = createDocument([createElement('paragraph', [createText('a')])])
    const result = applySteps(doc, wrapInList(doc, [0], 'bullet_list'))
    expect(result.children[0]).toMatchObject({ type: 'bullet_list' })
  })

  it('从列表还原', () => {
    const doc = createDocument([createElement('paragraph', [createText('a')])])
    const list = applySteps(doc, wrapInList(doc, [0], 'bullet_list'))
    const back = applySteps(list, unwrapFromList(list, [0]))
    expect(back).toEqual(doc)
  })
})
