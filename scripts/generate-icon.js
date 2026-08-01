const fs = require('node:fs')
const zlib = require('node:zlib')

function writeUInt32BE(buf, val, offset) {
  buf[offset] = (val >>> 24) & 0xff
  buf[offset + 1] = (val >>> 16) & 0xff
  buf[offset + 2] = (val >>> 8) & 0xff
  buf[offset + 3] = val & 0xff
}

const crcTable = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  }
  crcTable[i] = c
}

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  writeUInt32BE(len, data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  writeUInt32BE(crcBuf, crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function createPng(width, height, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  writeUInt32BE(ihdr, width, 0)
  writeUInt32BE(ihdr, height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const rowSize = width * 4
  const raw = Buffer.alloc((rowSize + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (rowSize + 1)] = 0
    pixels.copy(raw, y * (rowSize + 1) + 1, y * rowSize, (y + 1) * rowSize)
  }
  const idat = zlib.deflateSync(raw)

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax
  const aby = by - ay
  const apx = px - ax
  const apy = py - ay
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby)))
  const dx = ax + t * abx - px
  const dy = ay + t * aby - py
  return Math.sqrt(dx * dx + dy * dy)
}

function isInsideRoundedRect(px, py, x, y, width, height, radius) {
  const cx = Math.max(x + radius, Math.min(px, x + width - radius))
  const cy = Math.max(y + radius, Math.min(py, y + height - radius))
  const dx = px - cx
  const dy = py - cy
  return dx * dx + dy * dy <= radius * radius
}

function createIcon(size) {
  const W = size
  const H = size
  const pixels = Buffer.alloc(W * H * 4)

  const scale = size / 256
  const stroke = 18 * scale
  const halfStroke = stroke / 2

  const background = {
    x: 16 * scale,
    y: 16 * scale,
    width: 224 * scale,
    height: 224 * scale,
    radius: 48 * scale
  }
  const a = { x: 64 * scale, y: 168 * scale }
  const b = { x: 112 * scale, y: 120 * scale }
  const c = { x: 64 * scale, y: 72 * scale }
  const d = { x: 136 * scale, y: 184 * scale }
  const e = { x: 200 * scale, y: 184 * scale }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // 超采样 4x 抗锯齿
      let backgroundCoverage = 0
      let foregroundCoverage = 0
      const samples = 4
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples
          const py = y + (sy + 0.5) / samples
          if (
            isInsideRoundedRect(
              px,
              py,
              background.x,
              background.y,
              background.width,
              background.height,
              background.radius
            )
          ) {
            backgroundCoverage++
          }
          const d1 = Math.min(
            distanceToSegment(px, py, a.x, a.y, b.x, b.y),
            distanceToSegment(px, py, b.x, b.y, c.x, c.y)
          )
          const d2 = distanceToSegment(px, py, d.x, d.y, e.x, e.y)
          if (Math.min(d1, d2) <= halfStroke) foregroundCoverage++
        }
      }
      const sampleCount = samples * samples
      const backgroundAlpha = backgroundCoverage / sampleCount
      const foregroundAlpha = foregroundCoverage / sampleCount
      const alpha = foregroundAlpha + backgroundAlpha * (1 - foregroundAlpha)
      if (alpha > 0) {
        const i = (y * W + x) * 4
        const red = (255 * foregroundAlpha + 10 * backgroundAlpha * (1 - foregroundAlpha)) / alpha
        const green = (255 * foregroundAlpha + 10 * backgroundAlpha * (1 - foregroundAlpha)) / alpha
        const blue = (255 * foregroundAlpha + 10 * backgroundAlpha * (1 - foregroundAlpha)) / alpha
        pixels[i] = Math.round(red)
        pixels[i + 1] = Math.round(green)
        pixels[i + 2] = Math.round(blue)
        pixels[i + 3] = Math.round(alpha * 255)
      }
    }
  }

  return createPng(W, H, pixels)
}

function createIco(pngs) {
  const entries = pngs.map(({ size, data }) => {
    return {
      width: size >= 256 ? 0 : size,
      height: size >= 256 ? 0 : size,
      colorCount: 0,
      reserved: 0,
      planes: 1,
      bitCount: 32,
      bytesInRes: data.length,
      data
    }
  })

  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)

  const entrySize = 16
  const dataOffset = header.length + entries.length * entrySize

  const dirBuffers = []
  const dataBuffers = []
  let currentOffset = dataOffset

  for (const entry of entries) {
    const dir = Buffer.alloc(entrySize)
    dir[0] = entry.width
    dir[1] = entry.height
    dir[2] = entry.colorCount
    dir[3] = entry.reserved
    dir.writeUInt16LE(entry.planes, 4)
    dir.writeUInt16LE(entry.bitCount, 6)
    dir.writeUInt32LE(entry.bytesInRes, 8)
    dir.writeUInt32LE(currentOffset, 12)
    dirBuffers.push(dir)
    dataBuffers.push(entry.data)
    currentOffset += entry.data.length
  }

  return Buffer.concat([header, ...dirBuffers, ...dataBuffers])
}

const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngBuffers = sizes.map((size) => ({ size, data: createIcon(size) }))

fs.writeFileSync('resources/icon.png', pngBuffers.find((p) => p.size === 256).data)
fs.writeFileSync('resources/icon.ico', createIco(pngBuffers))
console.log('Generated resources/icon.png and resources/icon.ico')
