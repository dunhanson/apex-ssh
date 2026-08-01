// M1 交互项验收：vim 编辑保存退出、方向键历史、Tab 补全、窗口 resize 同步
// 前置：应用已运行且有一个已连接的终端标签（无则先点“本地-密码”）
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
const focusTerm = () =>
  ev2(`document.querySelector('.terminal-instance:not(.hidden) .xterm-helper-textarea')?.focus()`)

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

// 确保有会话
const hasTerm = await ev2(`!!document.querySelector('.terminal-instance')`)
if (!hasTerm) {
  await ev2(`document.querySelector('button[title="配置和连接"], button[title="Connections"]')?.click()`)
  await sleep(300)
  await ev2(`[...document.querySelectorAll('[data-connection-host]')].find(el => el.textContent.includes('本地-密码'))?.click()`)
  await sleep(3500)
}

// 1. vim：打开 → i 输入 → Esc → :wq → cat 校验
await focusTerm()
await typeText('vim /tmp/vim-apex-test.txt\r')
await sleep(1500)
await key('i', 'KeyI', 73, 'i')
await sleep(300)
await typeText('hello-apex-vim')
await sleep(300)
await key('Escape', 'Escape', 27)
await sleep(300)
await typeText(':wq\r')
await sleep(1000)
await typeText('cat /tmp/vim-apex-test.txt\r')
await sleep(1000)
const afterVim = await readTerm()
check('vim 打开/编辑/保存/退出', afterVim.includes('hello-apex-vim'), 'cat 输出含写入内容')
check('vim 退出后终端状态正常', /~\$\s*$/.test(afterVim.trimEnd()) || afterVim.includes(':~$'), '提示符恢复')

// 2. 方向键：↑ 调出上一条命令
await focusTerm()
await key('ArrowUp', 'ArrowUp', 38)
await sleep(600)
const afterUp = await readTerm()
check('方向键 ↑ 历史召回', afterUp.includes('cat /tmp/vim-apex-test.txt~') || afterUp.trimEnd().endsWith('cat /tmp/vim-apex-test.txt'), '上一条命令重现')
await key('Enter', 'Enter', 13, '\r')
await sleep(500)

// 3. Tab 补全：输入部分路径按 Tab 补全
await focusTerm()
await typeText('cat /tmp/vim-apex')
await key('Tab', 'Tab', 9)
await sleep(600)
const afterTab = await readTerm()
check('Tab 补全', afterTab.includes('cat /tmp/vim-apex-test.txt'), '路径补全成功')
await key('Enter', 'Enter', 13, '\r')
await sleep(500)

// 4. stty size 记录当前值（窗口 resize 由外部 PowerShell 配合，这里只取基线）
await focusTerm()
await typeText('stty size\r')
await sleep(800)
const sizeTerm = await readTerm()
const m = sizeTerm.match(/(\d+) (\d+)[^\d]*~?\$?\s*$/)
console.log('当前 stty size:', m ? `${m[1]}x${m[2]}` : sizeTerm.slice(-60))

const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} 项通过`)
process.exit(failed ? 1 : 0)
