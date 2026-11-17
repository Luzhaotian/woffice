import { describe, expect, it } from 'vitest'
import { crc32, utf8Encode, ZipReader, ZipWriter } from '@/convert/docx/zip'

describe('ZIP 读写', () => {
  it('写入后读取（deflate 压缩）', async () => {
    const writer = new ZipWriter()
    writer.add('a.txt', 'hello world')
    writer.add('dir/b.txt', utf8Encode('中文内容'))
    const blob = await writer.generate()
    const reader = await ZipReader.parse(await blob.arrayBuffer())
    expect(reader.getString('a.txt')).toBe('hello world')
    expect(reader.getString('dir/b.txt')).toBe('中文内容')
  })

  it('stored（不压缩）', async () => {
    const writer = new ZipWriter()
    writer.add('a.txt', 'raw content')
    const blob = await writer.generate(false)
    const reader = await ZipReader.parse(await blob.arrayBuffer())
    expect(reader.getString('a.txt')).toBe('raw content')
  })

  it('多条目 + 空条目列表', async () => {
    const writer = new ZipWriter()
    const empty = await writer.generate()
    expect((await ZipReader.parse(await empty.arrayBuffer())).entries.size).toBe(0)

    writer.add('1.txt', 'one')
    writer.add('2.txt', 'two')
    const reader = await ZipReader.parse(await (await writer.generate()).arrayBuffer())
    expect(reader.entries.size).toBe(2)
  })

  it('crc32 标准校验值', () => {
    expect(crc32(utf8Encode('123456789'))).toBe(0xcbf43926)
  })

  it('非法 ZIP 抛错', async () => {
    await expect(ZipReader.parse(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow()
  })
})
