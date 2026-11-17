/**
 * numbering.xml 解析：numId → 列表类型（bullet / order）
 */

import { child, elementsByLocalName, parseXml, val } from '@/convert/docx/ooxml'

export type ListType = 'bullet' | 'order'

export class NumberingInfo {
  private readonly numIdToType = new Map<string, ListType>()

  constructor(xml?: string) {
    if (xml) this.parse(xml)
  }

  private parse(xml: string): void {
    const dom = parseXml(xml)
    const abstractTypes = new Map<string, ListType>()

    for (const abs of elementsByLocalName(dom, 'abstractNum')) {
      const id = abs.getAttribute('w:abstractNumId') ?? ''
      const level0 = child(abs, 'lvl')
      const fmt = level0 ? val(level0, 'numFmt') : undefined
      abstractTypes.set(id, fmt === 'bullet' ? 'bullet' : 'order')
    }

    for (const num of elementsByLocalName(dom, 'num')) {
      const numId = num.getAttribute('w:numId') ?? ''
      const abstractId = val(num, 'abstractNumId')
      const type = (abstractId ? abstractTypes.get(abstractId) : undefined) ?? 'bullet'
      this.numIdToType.set(numId, type)
    }
  }

  typeOf(numId: string): ListType {
    return this.numIdToType.get(numId) ?? 'bullet'
  }
}
