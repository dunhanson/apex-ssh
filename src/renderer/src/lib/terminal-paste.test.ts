import { describe, expect, it } from 'vitest'
import { getPasteMetrics, isMultilinePaste } from './terminal-paste'

describe('isMultilinePaste', () => {
  it('单行内容不触发确认', () => {
    expect(isMultilinePaste('echo hello')).toBe(false)
  })

  it('兼容 LF、CRLF 和 CR 换行', () => {
    expect(isMultilinePaste('echo one\necho two')).toBe(true)
    expect(isMultilinePaste('echo one\r\necho two')).toBe(true)
    expect(isMultilinePaste('echo one\recho two')).toBe(true)
  })
})

describe('getPasteMetrics', () => {
  it('规范化换行后统计行数，并保留原始字符数', () => {
    const text = 'echo one\r\necho two\r\npwd'
    expect(getPasteMetrics(text)).toEqual({ lines: 3, characters: text.length })
  })

  it('尾部换行计入可能执行的空行', () => {
    expect(getPasteMetrics('pwd\n')).toEqual({ lines: 2, characters: 4 })
  })
})
