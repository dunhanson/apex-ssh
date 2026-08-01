// M2 验收（二）：移到新窗口（通道不断/历史不丢）、断线自动重连、历史弹窗（>3 更多/筛选/删除）
import { execSync } from 'node:child_process'

const TABBAR = `document.querySelector('[data-tab-bar]')`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0, fail = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ' — ' + extra}`)
  ok ? pass++ : fail++
}

// CDP 连接辅助：可反复重连以发现新窗口
let ws, msgId = 0
const pending = new Map()
async function connectCdp(urlContains) {
  const targets = await (await fetch('http://localhost:9222/json')).json()
  const page = targets.find((t) => t.type === 'page' && t.url.includes(urlContains))
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
  // 后台/被遮挡的窗口里 focus() 无效、CDP 键事件落不下，先激活
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
// 被遮挡的窗口里 CDP 键事件落不到页面（Windows 遮挡判定），
// 输入注入改走应用自身的 ssh.write IPC（与 xterm onData 同一通道）
const sshType = async (sessionId, text) =>
  ev2(`window.api.ssh.write('${sessionId}', ${JSON.stringify(text)})`)
const currentSessionId = () => ev2(`[...window.__terminals.keys()][0]`)
// 遮挡窗口的 rAF 渲染停摆时 xterm DOM 不更新，读终端内容走 serialize（直接读缓冲区）
const termIncludes = async (sessionId, text, timeoutMs = 8000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const t = await ev2(`window.__terminals.get('${sessionId}')?.serialize.serialize() ?? ''`)
    if (t.includes(text)) return true
    await sleep(300)
  }
  return false
}
// 等待表达式为真（避免固定 sleep 的时序抖动）
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
  return ev2(`[...document.querySelectorAll('[data-connection-host]')].find(h => h.textContent.includes(${JSON.stringify(label)}))?.click()`)
}

// ---- 移到新窗口 ----
await connectCdp('localhost:5173')
await clickHost('本地-密码')
await waitFor(`!!${TABBAR}.querySelector('[data-session-tab][data-status="connected"]')`, 15000)
await sleep(500)
// 打一个标记命令，验证历史迁移（输入走 ssh.write IPC，与 xterm onData 同一通道）
const MARKER = `MV${Math.floor(performance.now())}`
const sid = await currentSessionId()
await sshType(sid, `echo ${MARKER}\r`)
const markerSeen = await termIncludes(sid, MARKER)
check('迁出前终端有标记输出', markerSeen)

await ev2(`(() => {
  const tab = ${TABBAR}.querySelectorAll('.group')[0]
  tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window }))
  return true
})()`)
await sleep(400)
await ev2(`[...document.querySelectorAll('[role="menuitem"]')].find(i => i.textContent === '移到新窗口')?.click()`)
// 主窗口标签移除回空状态
const removed = await waitFor(`!!document.querySelector('input[placeholder*="搜索已保存主机"], input[placeholder*="Search saved hosts"]')`, 8000)
const mainAfterMove = await ev2(`(() => ({
  tabs: ${TABBAR}.querySelectorAll('.group').length,
  empty: !!document.querySelector('input[placeholder*="搜索已保存主机"], input[placeholder*="Search saved hosts"]')
}))()`)
check('迁出后主窗口标签移除', removed && mainAfterMove.tabs === 0, JSON.stringify(mainAfterMove))

// 新窗口出现
const detachedFound = await connectCdp('detached=')
check('独立窗口已打开', detachedFound)
if (detachedFound) {
  await sleep(1500)
  const detachedText = await ev2(`document.querySelector('.terminal-instance .xterm-rows')?.textContent ?? ''`)
  check('历史不丢（快照含标记）', detachedText.includes(MARKER), detachedText.slice(-80))
  // 通道不断：新窗口里继续执行命令
  const MARKER2 = `${MARKER}X`
  const dsid = await ev2(`new URLSearchParams(location.search).get('detached')`)
  await sshType(dsid, `echo ${MARKER2}\r`)
  const ok2 = await waitFor(`(document.querySelector('.terminal-instance .xterm-rows')?.textContent ?? '').includes('${MARKER2}')`, 8000)
  check('通道不断（新窗口可继续交互）', ok2)
  // 关闭独立窗口
  await ev2(`window.api.window.close()`)
  await sleep(1000)
  const gone = !(await (await fetch('http://localhost:9222/json')).json()).some((t) => t.url.includes('detached='))
  check('独立窗口可关闭', gone)
}

// ---- 断线自动重连（重启容器模拟网络闪断） ----
await connectCdp('localhost:5173')
await clickHost('本地-密码')
await sleep(2500)
const preDrop = await ev2(`!!${TABBAR}.querySelector('[data-session-tab][data-status="connected"]')`)
check('重连测试前连接正常', preDrop)

execSync('docker restart apex-ssh-pass', { stdio: 'pipe' })
// 等待自动重连成功（退避 2s/4s/8s，容器重启数秒，最长等 30s）
let reconnected = false
let sawToast = false
for (let i = 0; i < 60; i++) {
  await sleep(500)
  const state = await ev2(`(() => ({
    green: !!${TABBAR}.querySelector('[data-session-tab][data-status="connected"]'),
    toast: document.body.textContent.includes('自动重连')
  }))()`)
  if (state.toast) sawToast = true
  if (state.green && i > 4) { reconnected = true; break }
}
check('断线出现自动重连提示', sawToast)
check('容器恢复后自动重连成功', reconnected)

// 重连后终端可交互
const MARKER3 = `RC${Math.floor(performance.now())}`
const sid3 = await currentSessionId()
await sshType(sid3, `echo ${MARKER3}\r`)
check('重连后终端可交互', await termIncludes(sid3, MARKER3))

// ---- 历史弹窗：补足 >3 条最近使用，验证 更多… / 筛选 / 单条删除 ----
// 再加 5 台主机并各连一次（recents 达到 7 条）
const extraIds = await ev2(`(async () => {
  const ids = []
  for (let i = 1; i <= 5; i++) {
    const h = await window.api.hosts.add({
      label: '历史填充-' + i, host: '127.0.0.1', port: 2222, username: 'apex',
      group: 'Temp', auth: { type: 'password', password: 'apex123' }
    })
    ids.push(h.id)
  }
  return ids
})()`)
await ev2(`location.reload()`)
await sleep(2500)
await connectCdp('localhost:5173')
for (let i = 1; i <= 5; i++) {
  await clickHost(`历史填充-${i}`)
  await sleep(2200)
}
// 全部关闭回空状态
await ev2(`(() => {
  const tab = ${TABBAR}.querySelectorAll('.group')[0]
  tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window }))
  return true
})()`)
await sleep(400)
await ev2(`[...document.querySelectorAll('[role="menuitem"]')].find(i => i.textContent === '全部关闭')?.click()`)
await sleep(1000)

const moreBtn = await ev2(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('更多'))`)
check('超过 3 条显示「更多…」入口', moreBtn)
await ev2(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('更多'))?.click()`)
await sleep(600)
const historyCount = await ev2(`document.querySelectorAll('[data-slot="dialog-content"] [data-recent-row]').length`)
check('历史弹窗列出全部记录', historyCount >= 7, `rows=${historyCount}`)
// 筛选
await ev2(`(() => {
  const input = document.querySelector('[data-slot="dialog-content"] input')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, '历史填充-3')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(400)
const filtered = await ev2(`(() => {
  const rows = [...document.querySelectorAll('[data-slot="dialog-content"] [data-recent-row]')]
  return { count: rows.length, text: rows[0]?.textContent ?? '' }
})()`)
check('历史弹窗可筛选', filtered.count === 1 && filtered.text.includes('历史填充-3'), JSON.stringify(filtered))
// 单条删除
await ev2(`document.querySelector('[data-slot="dialog-content"] [data-recent-row] .icon-btn')?.click()`)
await sleep(400)
const afterDelete = await ev2(`document.querySelectorAll('[data-slot="dialog-content"] [data-recent-row]').length`)
check('历史单条删除生效', afterDelete === 0, `rows=${afterDelete}`)

// 清理填充主机
await ev2(`(async () => { for (const id of ${JSON.stringify(extraIds)}) await window.api.hosts.delete(id); return true })()`)
await ev2(`location.reload()`)

console.log(`\n${pass}/${pass + fail} 项通过`)
process.exit(fail ? 1 : 0)
