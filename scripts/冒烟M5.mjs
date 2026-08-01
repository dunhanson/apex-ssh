// M5 冒烟：打包产物（release/win-unpacked）走通 M1 核心链路
// 无 DEV 暴露的 __terminals，改用 window.api.ssh.onStatus/onData 挂钩子验证真实会话
import { fileURLToPath } from 'node:url'

const KEY_PATH = fileURLToPath(new URL('../deploy/keys/id_ed25519', import.meta.url))

const targets = await (await fetch('http://localhost:9222/json')).json()
const page = targets.find((t) => t.type === 'page' && t.url.includes('app.asar'))
if (!page) {
  console.log('❌ 未找到打包应用页面（期望 URL 含 app.asar）')
  process.exit(1)
}
console.log(`目标页面: ${page.url}`)
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
}
const send = (method, params) =>
  new Promise((res) => {
    const i = ++id
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const ev2 = async (expr) =>
  (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }))
    .result?.result?.value
const waitFor = async (expr, timeoutMs = 10000, interval = 300) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await ev2(expr)) return true
    await sleep(interval)
  }
  return false
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const clickHost = async (label) => {
  await ev2(`document.querySelector('button[title="配置和连接"], button[title="Connections"]')?.click()`)
  await sleep(300)
  return ev2(`[...document.querySelectorAll('[data-connection-host]')].find(h => h.textContent.includes(${JSON.stringify(label)}))?.click()`)
}
let pass = 0, fail = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ' — ' + extra}`)
  ok ? pass++ : fail++
}

// 状态/数据钩子（生产构建可用：preload 白名单 API）
const HOOKS = `(() => {
  window.__smoke = { status: [], data: '' }
  const dec = new TextDecoder()
  window.api.ssh.onStatus((ev) => window.__smoke.status.push(ev))
  window.api.ssh.onData((ev) => { window.__smoke.data += dec.decode(ev.data) })
  return true
})()`

await ev2(HOOKS)

// ---- 添加两台主机（密码 + 密钥） ----
const addRes = await ev2(`(async () => {
  const pw = await window.api.hosts.add({ label: '冒烟-密码', host: '127.0.0.1', port: 2222, username: 'apex', group: '冒烟', auth: { type: 'password', password: 'apex123' } })
  const key = await window.api.hosts.add({ label: '冒烟-密钥', host: '127.0.0.1', port: 2223, username: 'apex', group: '冒烟', auth: { type: 'key', privateKeyPath: '${KEY_PATH}' } })
  return { pw: !!pw, key: !!key }
})()`)
check('添加密码 + 密钥主机', addRes?.pw && addRes?.key, JSON.stringify(addRes))

// ---- 重载页面验证持久化，并重挂钩子 ----
await ev2('location.reload()')
await sleep(2500)
await ev2(HOOKS)
await ev2(`document.querySelector('button[title="配置和连接"], button[title="Connections"]')?.click()`)
await sleep(300)
const persisted = await ev2(`(() => {
  const items = [...document.querySelectorAll('[data-connection-host]')].map(h => h.textContent)
  return { pw: items.some(t => t.includes('冒烟-密码')), key: items.some(t => t.includes('冒烟-密钥')) }
})()`)
check('主机配置重启（重载）后仍在', persisted.pw && persisted.key, JSON.stringify(persisted))

// ---- 连接密码主机：3 秒内绿点 ----
await clickHost('冒烟-密码')
const t0 = Date.now()
const pwConnected = await waitFor(`window.__smoke.status.some(e => e.status === 'connected')`, 10000)
const elapsed = Date.now() - t0
const pwSession = await ev2(`window.__smoke.status.find(e => e.status === 'connected')?.sessionId`)
check('密码主机 3 秒内连接成功', pwConnected && elapsed < 3000, `elapsed=${elapsed}ms`)
const greenDot = await waitFor(`!!document.querySelector('[data-tab-bar] [data-session-tab][data-status="connected"]')`, 3000)
check('标签状态点为绿（已连接）', greenDot)

// ---- ls --color：真实 Shell 提示符 + ANSI 彩色输出 ----
await ev2(`window.api.ssh.write('${pwSession}', 'ls --color\\n')`)
const sawPrompt = await waitFor(`window.__smoke.data.includes(':~$') && window.__smoke.data.includes('\\x1b[')`, 8000)
check('真实 Shell 提示符 + ls --color 彩色输出', sawPrompt)

// ---- 连接密钥主机：第二个标签 ----
await ev2(`window.__smoke.status = []`)
await clickHost('冒烟-密钥')
const keyConnected = await waitFor(`window.__smoke.status.some(e => e.status === 'connected')`, 10000)
const tabCount = await ev2(`document.querySelectorAll('[data-tab-bar] [data-session-tab]').length`)
check('密钥主机连接成功（2 个标签）', keyConnected && tabCount === 2, `connected=${keyConnected} tabs=${tabCount}`)

// ---- 关闭标签断开 ----
await ev2(`document.querySelector('[data-tab-bar] [data-session-tab] .icon-btn')?.click()`)
await sleep(600)
const afterClose = await ev2(`document.querySelectorAll('[data-tab-bar] [data-session-tab]').length`)
check('关闭标签页断开', afterClose === 1, `tabs=${afterClose}`)

// ---- 清理：删除冒烟主机 ----
const cleaned = await ev2(`(async () => {
  const hosts = await window.api.hosts.list()
  const smoke = hosts.filter(h => h.group === '冒烟')
  for (const h of smoke) await window.api.hosts.delete(h.id)
  return smoke.length
})()`)
check('清理冒烟主机', cleaned >= 2, `deleted=${cleaned}`)

console.log(`\n${pass}/${pass + fail} 项通过`)
process.exit(fail ? 1 : 0)
