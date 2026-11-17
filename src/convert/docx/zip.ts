/**
 * 自研 ZIP 读写（不依赖三方库）
 *
 * 读取：解析中央目录 → 逐条目读取本地头 → deflate 用原生 DecompressionStream('deflate-raw') 解压
 * 写入：本地头 + 中央目录 + EOCD；deflate 用原生 CompressionStream('deflate-raw') 压缩
 *
 * 仅支持 stored(0) 与 deflate(8) 两种压缩方式（覆盖 99% 的 docx）。
 */

const LOCAL_SIGNATURE = 0x04034b50
const CENTRAL_SIGNATURE = 0x02014b50
const EOCD_SIGNATURE = 0x06054b50

export interface ZipEntry {
  name: string
  compressionMethod: number
  compressedSize: number
  uncompressedSize: number
  crc32: number
  data: Uint8Array
}

// ---------------------------------------------------------------------------
// 编码工具
// ---------------------------------------------------------------------------

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder('utf-8')

export function utf8Encode(text: string): Uint8Array {
  return utf8Encoder.encode(text)
}

export function utf8Decode(data: Uint8Array): string {
  return utf8Decoder.decode(data)
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// ---------------------------------------------------------------------------
// 读取
// ---------------------------------------------------------------------------

export class ZipReader {
  readonly entries = new Map<string, ZipEntry>()

  private constructor() {}

  static async parse(source: Uint8Array | ArrayBuffer): Promise<ZipReader> {
    const data = source instanceof Uint8Array ? source : new Uint8Array(source)
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

    let eocd = -1
    for (let i = data.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === EOCD_SIGNATURE) {
        eocd = i
        break
      }
    }
    if (eocd < 0) throw new Error('不是有效的 ZIP 文件（缺少 EOCD 记录）')

    const count = view.getUint16(eocd + 10, true)
    let offset = view.getUint32(eocd + 16, true)
    const reader = new ZipReader()

    for (let i = 0; i < count; i++) {
      if (offset + 46 > data.length || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
        throw new Error('ZIP 中央目录损坏')
      }
      const compressionMethod = view.getUint16(offset + 10, true)
      const crc = view.getUint32(offset + 16, true)
      const compressedSize = view.getUint32(offset + 20, true)
      const uncompressedSize = view.getUint32(offset + 24, true)
      const nameLength = view.getUint16(offset + 28, true)
      const extraLength = view.getUint16(offset + 30, true)
      const commentLength = view.getUint16(offset + 32, true)
      const localHeaderOffset = view.getUint32(offset + 42, true)
      const name = utf8Decode(data.subarray(offset + 46, offset + 46 + nameLength))

      if (localHeaderOffset + 30 > data.length || view.getUint32(localHeaderOffset, true) !== LOCAL_SIGNATURE) {
        throw new Error(`ZIP 本地头损坏: ${name}`)
      }
      const localNameLength = view.getUint16(localHeaderOffset + 26, true)
      const localExtraLength = view.getUint16(localHeaderOffset + 28, true)
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
      const raw = data.subarray(dataStart, dataStart + compressedSize)
      const content = compressionMethod === 8 ? await inflateRaw(raw) : raw.slice()

      reader.entries.set(name, {
        name,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        crc32: crc,
        data: content,
      })
      offset += 46 + nameLength + extraLength + commentLength
    }
    return reader
  }

  read(name: string): Uint8Array | undefined {
    return this.entries.get(name)?.data
  }

  getString(name: string): string | undefined {
    const data = this.read(name)
    return data === undefined ? undefined : utf8Decode(data)
  }

  /** 读取文本文件并去掉 XML 声明头（如有） */
  getXml(name: string): string | undefined {
    const text = this.getString(name)
    return text
  }
}

// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------

export class ZipWriter {
  private readonly entries: { name: string; data: Uint8Array }[] = []

  add(name: string, data: Uint8Array | string): void {
    this.entries.push({ name, data: typeof data === 'string' ? utf8Encode(data) : data })
  }

  async generate(compress = true): Promise<Blob> {
    const chunks: Uint8Array[] = []
    const central: Uint8Array[] = []
    let offset = 0

    for (const entry of this.entries) {
      const nameBytes = utf8Encode(entry.name)
      const crc = crc32(entry.data)
      const compressed = compress ? await deflateRaw(entry.data) : entry.data
      const method = compress ? 8 : 0

      const local = new DataView(new ArrayBuffer(30))
      local.setUint32(0, LOCAL_SIGNATURE, true)
      local.setUint16(4, 20, true)
      local.setUint16(6, 0x0800, true) // UTF-8 文件名
      local.setUint16(8, method, true)
      local.setUint16(10, 0, true)
      local.setUint16(12, 0, true)
      local.setUint32(14, crc, true)
      local.setUint32(18, compressed.length, true)
      local.setUint32(22, entry.data.length, true)
      local.setUint16(26, nameBytes.length, true)
      local.setUint16(28, 0, true)
      chunks.push(new Uint8Array(local.buffer), nameBytes, compressed)

      const center = new DataView(new ArrayBuffer(46))
      center.setUint32(0, CENTRAL_SIGNATURE, true)
      center.setUint16(4, 20, true)
      center.setUint16(6, 20, true)
      center.setUint16(8, 0x0800, true)
      center.setUint16(10, method, true)
      center.setUint16(12, 0, true)
      center.setUint16(14, 0, true)
      center.setUint32(16, crc, true)
      center.setUint32(20, compressed.length, true)
      center.setUint32(24, entry.data.length, true)
      center.setUint16(28, nameBytes.length, true)
      center.setUint16(30, 0, true)
      center.setUint16(32, 0, true)
      center.setUint16(34, 0, true)
      center.setUint16(36, 0, true)
      center.setUint32(38, 0, true)
      center.setUint32(42, offset, true)
      central.push(new Uint8Array(center.buffer), nameBytes)

      offset += 30 + nameBytes.length + compressed.length
    }

    const centralStart = offset
    let centralSize = 0
    for (const chunk of central) {
      chunks.push(chunk)
      centralSize += chunk.length
    }

    const eocd = new DataView(new ArrayBuffer(22))
    eocd.setUint32(0, EOCD_SIGNATURE, true)
    eocd.setUint16(8, this.entries.length, true)
    eocd.setUint16(10, this.entries.length, true)
    eocd.setUint32(12, centralSize, true)
    eocd.setUint32(16, centralStart, true)
    chunks.push(new Uint8Array(eocd.buffer))

    return new Blob(chunks as BlobPart[], { type: 'application/zip' })
  }
}
