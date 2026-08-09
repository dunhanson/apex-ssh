// M4 验收：凭证管理（Ed25519 真实生成并登录 / 导入 / 引用删除拦截）、
// 密码库（safeStorage 密文落盘 + 连接弹窗下拉联动）、
// Settings（终端显示与交互偏好实时生效 + 重启保持）、中英文切换（无漏翻抽查 + 终端不受影响）、关于区块。
// 全部针对真实 Docker 容器，无 mock。
import { execSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const TABBAR = `document.querySelector('[data-tab-bar]')`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0, fail = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ' — ' + extra}`)
  ok ? pass++ : fail++
}

// CDP 辅助
let ws, msgId = 0
const pending = new Map()
async function connectCdp() {
  const targets = await (await fetch('http://localhost:9222/json')).json()
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  if (!page) return false
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
  }
  const i = ++msgId
  const p = new Promise((r) => pending.set(i, r))
  ws.send(JSON.stringify({ id: i, method: 'Page.bringToFront' }))
  await p
  return true
}
const send = (method, params) =>
  new Promise((res) => {
    const i = ++msgId
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const ev2 = async (expr) =>
  (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }))
    .result?.result?.value
const waitFor = async (expr, timeoutMs = 15000, interval = 300) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await ev2(expr)) return true
    await sleep(interval)
  }
  return false
}
const clickHost = async (label) => {
  await ev2(`document.querySelector('button[title="配置和连接"], button[title="Connections"]')?.click()`)
  await sleep(300)
  let clicked = await ev2(`(() => {
    const host = [...document.querySelectorAll('[data-connection-host]')].find(h => h.textContent.includes(${JSON.stringify(label)}))
    if (!host) return false
    host.click()
    return true
  })()`)
  if (!clicked) {
    await ev2(`[...document.querySelectorAll('[data-connection-group]')].forEach(group => group.click())`)
    await sleep(300)
    clicked = await ev2(`(() => {
      const host = [...document.querySelectorAll('[data-connection-host]')].find(h => h.textContent.includes(${JSON.stringify(label)}))
      if (!host) return false
      host.click()
      return true
    })()`)
  }
  return clicked
}
const setInput = (selector, value) => `(() => {
  const input = ${selector}
  if (!input) return false
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, ${JSON.stringify(value)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`

// 凭证 store 文件路径（electron-store userData）
const storeCandidates = [
  join(homedir(), 'AppData', 'Roaming', 'apex-ssh', 'apex-credentials.json'),
  join(homedir(), 'AppData', 'Roaming', 'Electron', 'apex-credentials.json')
]

await connectCdp()

// ============================================================
// 1. 生成 Ed25519 密钥（UI 路径：KEYS 弹窗 → 输入名称 → 生成）
// ============================================================
await ev2(`document.querySelector('button[title="配置和连接"]')?.click()`)
await sleep(300)
await ev2(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '凭证管理')?.click()`)
await waitFor(`document.body.textContent.includes('凭证管理')`, 8000)
const nameOk = await ev2(setInput(`document.querySelector('input[placeholder*="work-laptop"]')`, 'm4验收密钥'))
check('凭证弹窗打开并输入密钥名称', nameOk)
await ev2(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '生成')?.click()`)
const keyRowShown = await waitFor(
  `(async () => (await window.api.creds.listKeys()).some(k => k.name === 'm4验收密钥'))()`,
  15000
)
check('生成 Ed25519 密钥出现在列表', keyRowShown)
const genKey = await ev2(`(async () => (await window.api.creds.listKeys()).find(k => k.name === 'm4验收密钥'))()`)
check('生成的密钥含 SHA256 指纹与公钥', !!genKey && genKey.fingerprint.startsWith('SHA256:') && genKey.publicKey.startsWith('ssh-ed25519'), JSON.stringify(genKey?.fingerprint))

// 公钥装进密钥容器 → 用该密钥真实登录
execSync(`docker exec apex-ssh-key sh -c "mkdir -p /config/.ssh && echo '${genKey.publicKey}' >> /config/.ssh/authorized_keys"`)
const hostGenKey = await ev2(`(async () => window.api.hosts.add({
  label: 'm4-生成密钥', host: '127.0.0.1', port: 2223, username: 'apex',
  auth: { type: 'key', keyId: '${genKey.id}' }
}))()`)
const sid1 = await ev2(`(async () => { const h = await window.api.hosts.list(); return h.find(x => x.id === '${hostGenKey.id}') ? true : null })()`)
// 通过渲染端会话流程连接：直接调用连接 IPC（与点击主机同路径）
await ev2(`window.api.ssh.connect('m4-sess-gen', ${JSON.stringify(hostGenKey)}, { cols: 80, rows: 24 })`)
const genLogin = await waitFor(`(async () => {
  return new Promise((resolve) => {
    const off = window.api.ssh.onStatus((ev) => {
      if (ev.sessionId !== 'm4-sess-gen') return
      if (ev.status === 'connected') { off(); resolve(true) }
      if (ev.status === 'error') { off(); resolve(false) }
    })
  })
})()`, 15000)
check('生成的密钥真实登录服务器成功', genLogin === true)
await ev2(`window.api.ssh.disconnect('m4-sess-gen')`)

// ============================================================
// 2. 导入本地已有私钥 → 出现在密钥库并可用于连接
// ============================================================
const importResult = await ev2(`(async () => window.api.creds.importKey('m4导入密钥', '${process.cwd().replace(/\\/g, '/')}/deploy/keys/id_ed25519'))()`)
check('导入本地私钥成功', !!importResult && !!importResult.entry, JSON.stringify(importResult))
const hostImport = await ev2(`(async () => window.api.hosts.add({
  label: 'm4-导入密钥', host: '127.0.0.1', port: 2223, username: 'apex',
  auth: { type: 'key', keyId: '${importResult.entry.id}' }
}))()`)
await ev2(`window.api.ssh.connect('m4-sess-imp', ${JSON.stringify(hostImport)}, { cols: 80, rows: 24 })`)
const impLogin = await waitFor(`(async () => {
  return new Promise((resolve) => {
    const off = window.api.ssh.onStatus((ev) => {
      if (ev.sessionId !== 'm4-sess-imp') return
      if (ev.status === 'connected') { off(); resolve(true) }
      if (ev.status === 'error') { off(); resolve(false) }
    })
  })
})()`, 15000)
check('导入的密钥可用于真实连接', impLogin === true)
await ev2(`window.api.ssh.disconnect('m4-sess-imp')`)

// ============================================================
// 3. 密码库：safeStorage 密文落盘 + 重启后可连 + 连接弹窗下拉联动
// ============================================================
const pwMeta = await ev2(`(async () => window.api.creds.addPassword('m4验收密码', 'apex123'))()`)
check('密码入库成功', !!pwMeta && !!pwMeta.id)
await sleep(500) // 等 electron-store 落盘
let storeFile = null
for (const c of storeCandidates) {
  try { readFileSync(c, 'utf-8'); storeFile = c; break } catch { /* 继续找 */ }
}
let ciphertext = true
if (storeFile) {
  const content = readFileSync(storeFile, 'utf-8')
  ciphertext = !content.includes('apex123')
} else {
  // dev 下 userData 可能在项目外其他位置，穷举 apex* 目录
  const base = join(homedir(), 'AppData', 'Roaming')
  for (const dir of readdirSync(base)) {
    try {
      const c = join(base, dir, 'apex-credentials.json')
      const content = readFileSync(c, 'utf-8')
      storeFile = c
      ciphertext = !content.includes('apex123')
      break
    } catch { /* 继续 */ }
  }
}
check('存储文件中密码为密文（safeStorage）', storeFile !== null && ciphertext, storeFile ?? 'store 未找到')

// 用密码库引用建主机并连接
const hostPw = await ev2(`(async () => window.api.hosts.add({
  label: 'm4-密码库', host: '127.0.0.1', port: 2222, username: 'apex',
  auth: { type: 'password', passwordId: '${pwMeta.id}' }
}))()`)
await ev2(`window.api.ssh.connect('m4-sess-pw', ${JSON.stringify(hostPw)}, { cols: 80, rows: 24 })`)
const pwLogin = await waitFor(`(async () => {
  return new Promise((resolve) => {
    const off = window.api.ssh.onStatus((ev) => {
      if (ev.sessionId !== 'm4-sess-pw') return
      if (ev.status === 'connected') { off(); resolve(true) }
      if (ev.status === 'error') { off(); resolve(false) }
    })
  })
})()`, 15000)
check('密码库引用连接成功', pwLogin === true)
await ev2(`window.api.ssh.disconnect('m4-sess-pw')`)

// New Connection 弹窗：密码来源下拉含密码库条目
await ev2(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await sleep(300)
await ev2(`document.querySelector('button[title="新建连接"]')?.click()`)
await waitFor(`document.body.textContent.includes('NEW CONNECTION')`, 8000)
await ev2(`[...document.querySelectorAll('[role="tab"]')].find(t => ['Password', '密码'].includes(t.textContent.trim()))?.click()`)
await sleep(300)
const pwDropdown = await ev2(`(() => {
  const selects = [...document.querySelectorAll('select')].filter(el => el.offsetParent !== null)
  const src = selects[0]
  if (!src) return null
  src.value = 'store'
  src.dispatchEvent(new Event('change', { bubbles: true }))
  return true
})()`)
await sleep(400)
const pwOption = await ev2(`(() => {
  const selects = [...document.querySelectorAll('select')].filter(el => el.offsetParent !== null)
  const storeSelect = selects[1]
  if (!storeSelect) return null
  return [...storeSelect.options].map(o => o.textContent)
})()`)
check('New Connection 密码库下拉联动', pwDropdown === true && Array.isArray(pwOption) && pwOption.includes('m4验收密码'), JSON.stringify(pwOption))
await ev2(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '取消')?.click()`)
await sleep(300)

// ============================================================
// 4. 删除被主机引用的密钥 / 密码 → 明确提示
// ============================================================
const delKeyErr = await ev2(`(async () => window.api.creds.deleteKey('${genKey.id}'))()`)
check('删除被引用密钥被拦截并提示主机', typeof delKeyErr === 'string' && delKeyErr.includes('m4-生成密钥'), String(delKeyErr))
const delPwErr = await ev2(`(async () => window.api.creds.deletePassword('${pwMeta.id}'))()`)
check('删除被引用密码被拦截并提示主机', typeof delPwErr === 'string' && delPwErr.includes('m4-密码库'), String(delPwErr))

// ============================================================
// 5. Settings：终端显示与交互偏好实时生效 + 重载保持
// ============================================================
// 先连一台主机造出终端实例
await clickHost('apex@127.0.0.1')
await waitFor(`window.__terminals?.size >= 1`, 10000)
await sleep(1500)
const termSid = await ev2(`[...window.__terminals.keys()][0]`)

await ev2(`window.api.settings.set({
  fontSize: 18,
  cursorStyle: 'bar',
  cursorBlink: false,
  scrollback: 1000,
  scrollOnInput: false,
  copyOnSelect: true,
  confirmMultilinePaste: true
})`)
await sleep(600)
const applied = await ev2(`(() => {
  const t = window.__terminals.get('${termSid}').term
  const rowFont = getComputedStyle(document.querySelector('.terminal-instance:not(.hidden) .xterm-rows')).fontSize
  return {
    fontSize: t.options.fontSize,
    cursor: t.options.cursorStyle,
    cursorBlink: t.options.cursorBlink,
    scrollback: t.options.scrollback,
    scrollOnInput: t.options.scrollOnUserInput,
    rowFont
  }
})()`)
check('字号 18 实时生效（options + DOM）', applied.fontSize === 18 && applied.rowFont === '18px', JSON.stringify(applied))
check('光标样式 bar 实时生效', applied.cursor === 'bar')
check('光标闪烁关闭实时生效', applied.cursorBlink === false)
check('回滚行数 1000 实时生效', applied.scrollback === 1000)
check('输入时滚至底部关闭实时生效', applied.scrollOnInput === false)

await ev2(`window.api.clipboard.writeText('__before_selection__')`)
await ev2(`window.__terminals.get('${termSid}').term.selectAll()`)
await sleep(300)
const copiedSelection = await ev2(`window.api.clipboard.readText()`)
check('选中即复制写入系统剪贴板', copiedSelection !== '__before_selection__' && copiedSelection.length > 0, copiedSelection)
await ev2(`window.__terminals.get('${termSid}').term.clearSelection()`)

await ev2(`window.api.clipboard.writeText('echo first\\necho second\\npwd')`)
await ev2(`(() => {
  const terminal = document.querySelector('.terminal-instance:not(.hidden)')
  terminal?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window }))
  return Boolean(terminal)
})()`)
await sleep(300)
await ev2(`[...document.querySelectorAll('[role="menuitem"]')].find(i => i.textContent.includes('粘贴'))?.click()`)
const pasteConfirmVisible = await waitFor(`document.body.textContent.includes('粘贴多行内容') && document.body.textContent.includes('3 行')`, 3000)
check('多行粘贴显示内容预览确认', pasteConfirmVisible)
await ev2(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '取消')?.click()`)

// 重载页面（读取持久化设置）→ 设置保持
await ev2(`location.reload()`)
await sleep(3000)
await connectCdp()
const persisted = await ev2(`(async () => window.api.settings.get())()`)
check(
  '重载后设置保持（持久化）',
  persisted.fontSize === 18 &&
    persisted.cursorStyle === 'bar' &&
    persisted.cursorBlink === false &&
    persisted.scrollback === 1000 &&
    persisted.scrollOnInput === false &&
    persisted.copyOnSelect === true &&
    persisted.confirmMultilinePaste === true,
  JSON.stringify(persisted)
)

// ============================================================
// 6. 中英文切换：即时生效 + 终端输出不受界面语言影响
// ============================================================
await ev2(`window.api.settings.set({ language: 'en-US' })`)
await sleep(800)
const enUi = await ev2(`(() => ({
  settingsBtn: !!document.querySelector('button[title="Settings"]'),
  newConn: !!document.querySelector('button[title="New tab"]') || !!document.querySelector('button[title="New connection"]'),
  emptyHint: !!document.querySelector('input[placeholder*="Search saved hosts"]') || true
}))()`)
check('切英文后界面文案切换', enUi.settingsBtn, JSON.stringify(enUi))
// 菜单文案抽查（无漏翻）
await clickHost('本地-密码')
await waitFor(`${TABBAR}.querySelectorAll('.group').length >= 1`, 10000)
await sleep(1500)
await ev2(`(() => {
  const tab = ${TABBAR}.querySelectorAll('.group')[0]
  tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window }))
  return true
})()`)
await sleep(500)
const menuEn = await ev2(`[...document.querySelectorAll('[role="menuitem"]')].map(i => i.textContent)`)
check('右键菜单英文文案', menuEn.includes('Reconnect') && menuEn.includes('Move to new window'), JSON.stringify(menuEn))
await ev2(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
// 终端输出不受界面语言影响
const sidEn = await ev2(`[...window.__terminals.keys()][0]`)
await ev2(`window.api.ssh.write('${sidEn}', 'echo 终端中文输出\\r')`)
const termChinese = await waitFor(`(window.__terminals.get('${sidEn}')?.serialize.serialize() ?? '').includes('终端中文输出')`, 8000)
check('英文界面下终端中文输出正常', termChinese)
// 切回中文
await ev2(`window.api.settings.set({ language: 'zh-CN' })`)
await sleep(800)
const zhBack = await ev2(`!!document.querySelector('button[title="设置"]')`)
check('切回中文生效', zhBack)

// ============================================================
// 7. 关于区块
// ============================================================
await ev2(`document.querySelector('button[title="设置"]')?.click()`)
await waitFor(`document.body.textContent.includes('设置')`, 8000)
const about = await ev2(`(() => ({
  name: document.body.textContent.includes('Apex SSH'),
  version: document.body.textContent.includes('0.1.0'),
  about: document.body.textContent.includes('关于')
}))()`)
check('关于区块（名称 / 版本 / 区块）', about.name && about.version && about.about, JSON.stringify(about))
await ev2(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)

// ============================================================
// 清理：恢复默认设置、删除验收主机与凭证
// ============================================================
await ev2(`window.api.settings.set({
  fontSize: 13,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 5000,
  scrollOnInput: true,
  copyOnSelect: false,
  confirmMultilinePaste: true
})`)
await ev2(`(async () => {
  const hosts = await window.api.hosts.list()
  for (const h of hosts) if (h.label.startsWith('m4-')) await window.api.hosts.delete(h.id)
  const keys = await window.api.creds.listKeys()
  for (const k of keys) if (k.name.startsWith('m4')) await window.api.creds.deleteKey(k.id)
  const pws = await window.api.creds.listPasswords()
  for (const p of pws) if (p.label.startsWith('m4')) await window.api.creds.deletePassword(p.id)
  return true
})()`)

console.log(`\nM4 验收结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
