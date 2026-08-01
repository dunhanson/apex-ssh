// frameless 窗口验证：截图 + 三键 IPC + 最大化状态同步
import { writeFileSync } from 'node:fs'

const targets = await (await fetch('http://localhost:9222/json')).json()
const page = targets.find((t) => t.type === 'page')
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 1. 三键存在且拖拽区域生效
const checks = await ev2(`(() => {
  const btns = document.querySelectorAll('.win-btn')
  const drag = getComputedStyle(document.querySelector('.app-drag')).webkitAppRegion
  return { winBtns: btns.length, dragRegion: drag }
})()`)
console.log('三键数量:', checks.winBtns, '拖拽区域:', checks.dragRegion)

// 2. 最大化切换 + 图标状态同步
await ev2(`window.api.window.toggleMaximize()`)
await sleep(600)
const max1 = await ev2(`window.api.window.isMaximized()`)
const icon1 = await ev2(`document.querySelectorAll('.win-btn')[1].title`)
await ev2(`window.api.window.toggleMaximize()`)
await sleep(600)
const max2 = await ev2(`window.api.window.isMaximized()`)
const icon2 = await ev2(`document.querySelectorAll('.win-btn')[1].title`)
console.log(`最大化切换: ${max1 === true && max2 === false ? '✅' : '❌'} (max=${max1}→${max2}, 图标 "${icon1}"→"${icon2}")`)

// 3. 截图（还原状态）
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('frameless-check.png', Buffer.from(shot.result.data, 'base64'))
console.log('截图已保存 frameless-check.png')
process.exit(0)
