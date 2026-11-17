import { describe, expect, it } from 'vitest'
import { WOFFICE_VERSION } from '@/index'

describe('woffice', () => {
  it('导出版本号', () => {
    expect(WOFFICE_VERSION).toBe('0.1.0')
  })
})
