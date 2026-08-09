const PASSWORD_GROUPS = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  'abcdefghijkmnopqrstuvwxyz',
  '23456789',
  '!@#$%^&*_-'
] as const

const PASSWORD_ALPHABET = PASSWORD_GROUPS.join('')
const UINT32_RANGE = 0x1_0000_0000

export const GENERATED_BACKUP_PASSWORD_LENGTH = 24

function randomIndex(max: number): number {
  const values = new Uint32Array(1)
  const limit = Math.floor(UINT32_RANGE / max) * max
  let value: number

  do {
    globalThis.crypto.getRandomValues(values)
    value = values[0]
  } while (value >= limit)

  return value % max
}

export function generateBackupPassword(
  length = GENERATED_BACKUP_PASSWORD_LENGTH
): string {
  if (!Number.isInteger(length) || length < PASSWORD_GROUPS.length) {
    throw new RangeError(`备份密码长度必须是至少 ${PASSWORD_GROUPS.length} 的整数`)
  }

  const characters = PASSWORD_GROUPS.map((group) => group[randomIndex(group.length)])

  while (characters.length < length) {
    characters.push(PASSWORD_ALPHABET[randomIndex(PASSWORD_ALPHABET.length)])
  }

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1)
    ;[characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]]
  }

  return characters.join('')
}
