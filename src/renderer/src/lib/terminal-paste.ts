export interface PasteMetrics {
  lines: number
  characters: number
}

export function isMultilinePaste(text: string): boolean {
  return /[\r\n]/.test(text)
}

export function getPasteMetrics(text: string): PasteMetrics {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return {
    lines: normalized ? normalized.split('\n').length : 0,
    characters: text.length
  }
}
