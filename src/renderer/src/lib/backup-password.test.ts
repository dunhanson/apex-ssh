import { describe, expect, it } from 'vitest'
import {
  GENERATED_BACKUP_PASSWORD_LENGTH,
  generateBackupPassword
} from './backup-password'

describe('随机备份密码', () => {
  it('生成固定长度且覆盖四类字符的密码', () => {
    const password = generateBackupPassword()

    expect(password).toHaveLength(GENERATED_BACKUP_PASSWORD_LENGTH)
    expect(password).toMatch(/[A-Z]/)
    expect(password).toMatch(/[a-z]/)
    expect(password).toMatch(/[0-9]/)
    expect(password).toMatch(/[!@#$%^&*_-]/)
    expect(password).not.toMatch(/[O0Il1]/)
  })

  it('连续生成的密码不重复', () => {
    const passwords = Array.from({ length: 32 }, () => generateBackupPassword())

    expect(new Set(passwords).size).toBe(passwords.length)
  })

  it('拒绝无法覆盖字符类别的长度', () => {
    expect(() => generateBackupPassword(3)).toThrow(RangeError)
    expect(() => generateBackupPassword(12.5)).toThrow(RangeError)
  })
})
