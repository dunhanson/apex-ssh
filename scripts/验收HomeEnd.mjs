// Home / End 键验收：bash readline 行首/行尾编辑
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
  (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result
    ?.value
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const key = async (k, code, vk, text) =>
  send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, text, windowsVirtualKeyCode: vk })
const typeText = async (text) => {
  for (const ch of text) {
    if (ch === '\r') await key('Enter', 'Enter', 13, '\r')
    else await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch })
  }
}
const readTerm = () =>
  ev2(`document.querySelector('.terminal-instance:not(.hidden) .xterm-rows')?.textContent ?? ''`)

await ev2(`document.querySelector('.terminal-instance:not(.hidden) .xterm-helper-textarea')?.focus()`)

// Home：输入 'echo AB'，Home 到行首，插入 'C' → 'Cecho AB' → 报 command not found
await typeText('echo AB')
await key('Home', 'Home', 36)
await sleep(200)
await typeText('C')
await key('Enter', 'Enter', 13, '\r')
await sleep(800)
const afterHome = await readTerm()
const homeOk = afterHome.includes('Cecho: command not found') || afterHome.includes('Cecho: not found')
console.log(`${homeOk ? '✅' : '❌'} Home 键（行首插入）`, homeOk ? '' : afterHome.slice(-120))

// End：输入 'echo AB'，Home 再 End 到行尾，追加 'C' → 'echo ABC' → 输出 ABC
await typeText('echo AB')
await key('Home', 'Home', 36)
await sleep(200)
await key('End', 'End', 35)
await sleep(200)
await typeText('C')
await key('Enter', 'Enter', 13, '\r')
await sleep(800)
const afterEnd = await readTerm()
const endOk = /ABC[~$0-9a-z]/.test(afterEnd) || afterEnd.includes('ABC7f') || afterEnd.includes('ABC\n')
console.log(`${endOk ? '✅' : '❌'} End 键（行尾追加）`, endOk ? '' : afterEnd.slice(-120))

process.exit(homeOk && endOk ? 0 : 1)
