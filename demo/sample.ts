/**
 * 示例文档：仅通过 `?sample` 查询参数加载，供 demo 展示与 e2e 用例使用。
 * 默认情况下 demo 是空白文档，方便直接导入 .docx 测试。
 */

import type { Document } from '@/index'
import { createDocument, createElement, createText } from '@/index'

export function createSampleDocument(): Document {
  return createDocument([
    createElement('paragraph', [
      createText('这是一份在浏览器本地编辑的文档，所有数据都不会离开你的设备。'),
    ]),
    createElement('heading', [createText('核心能力')], { level: 2 }),
    createElement('paragraph', [
      createText('选中文字即可使用上方工具栏设置 '),
      createText('加粗', [{ type: 'bold' }]),
      createText('、'),
      createText('斜体', [{ type: 'italic' }]),
      createText('、'),
      createText('下划线', [{ type: 'underline' }]),
      createText(' 等行内样式；也可以把段落切换成标题、引用或代码块。'),
    ]),
    createElement('bullet_list', [
      createElement('list_item', [
        createElement('paragraph', [
          createText('自研文档模型与编辑引擎（模型 / 引擎 / 渲染分层）'),
        ]),
      ]),
      createElement('list_item', [
        createElement('paragraph', [createText('docx 导入导出（OOXML + zip 完全自研）')]),
      ]),
      createElement('list_item', [
        createElement('paragraph', [createText('撤销重做、修订模式、批注、域、表格')]),
      ]),
    ]),
    createElement('blockquote', [
      createElement('paragraph', [createText('点击右上角「导入 .docx」打开一个 Word 文件试试。')]),
    ]),
    createElement('paragraph', [createText('')]),
  ])
}
