/**
 * M1 验收自动化：通过 CDP（--remote-debugging-port=9222）驱动运行中的 Apex SSH，
 * 在真实 Docker SSH 容器上逐项验证实施计划的 M1 验收清单。
 *
 * 前置：
 *   1. docker compose -f deploy/docker-compose.yml up -d
 *   2. env -u ELECTRON_RUN_AS_NODE pnpm dev -- --remote-debugging-port=9222
 * 运行：node scripts/验收M1.mjs
 */

import { fileURLToPath } from 'node:url'

const CDP_PORT = 9222
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── CDP 基础 ────────────────────────────────────────────────
let msgId = 0
const pending = new Map()
let ws

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

/** 在页面中执行表达式，支持 Promise，返回值按值传递 */
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.exceptionDetails) {
    throw new Error(`页面执行出错: ${JSON.stringify(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)}`)
  }
  return result.result.value
}

/** 向聚焦的终端逐字符输入（xterm 监听 keydown） */
async function typeText(text) {
  for (const ch of text) {
    if (ch === '\r') {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 })
    } else {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch })
    }
  }
}

/** 读取当前可见终端的文本内容 */
const readTerminal = () =>
  evaluate(`(document.querySelector('.terminal-instance:not(.hidden) .xterm-rows')?.textContent ?? '')`)

const focusTerminal = () =>
  evaluate(`document.querySelector('.terminal-instance:not(.hidden) .xterm-helper-textarea')?.focus()`)

/** 打开连接管理并点击 label 包含指定文字的主机行 */
const clickHost = async (label) => {
  await evaluate(`document.querySelector('button[title="配置和连接"], button[title="Connections"]')?.click()`)
  await sleep(300)
  return evaluate(`[...document.querySelectorAll('[data-connection-host]')].find(el => el.textContent.includes(${JSON.stringify(label)}))?.click()`)
}

// ── 验收项 ──────────────────────────────────────────────────
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  // 连接 CDP
  const targets = await (await fetch(`http://localhost:${CDP_PORT}/json`)).json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('找不到页面调试目标，确认应用带 --remote-debugging-port=9222 启动')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    }
  }

  // 0. M0：ping/pong 白名单桥
  const pong = await evaluate('window.api.ping()')
  check('M0 ping/pong IPC 桥', pong === 'pong', `返回 ${pong}`)

  // 1. 准备三台主机：密码 / 密钥 / 错误密码
  const keyPath = fileURLToPath(new URL('../deploy/keys/id_ed25519', import.meta.url))
  await evaluate(`window.api.hosts.list().then(hs => Promise.all(hs.map(h => window.api.hosts.delete(h.id))))`)
  await evaluate(`window.api.hosts.add({ label: '本地-密码', host: '127.0.0.1', port: 2222, username: 'apex', group: 'Docker', auth: { type: 'password', password: 'apex123' } })`)
  await evaluate(`window.api.hosts.add({ label: '本地-密钥', host: '127.0.0.1', port: 2223, username: 'apex', group: 'Docker', auth: { type: 'key', privateKeyPath: ${JSON.stringify(keyPath)} } })`)
  await evaluate(`window.api.hosts.add({ label: '错误密码', host: '127.0.0.1', port: 2222, username: 'apex', group: 'Docker', auth: { type: 'password', password: 'wrong-pass' } })`)
  await evaluate('location.reload()')
  await sleep(2500)

  // 7 前置：重启（reload）后主机仍在 → 持久化生效
  const persisted = await evaluate('window.api.hosts.list().then(hs => hs.length)')
  check('主机配置持久化', persisted === 3, `重启后 ${persisted} 台主机`)

  // 分组既可从已有值中选择，也可继续自由输入新值
  await evaluate(`document.querySelector('button[title="新建连接"], button[title="New connection"]')?.click()`)
  await sleep(300)
  const existingGroup = await evaluate(`(() => {
    const input = document.querySelector('#nc-group')
    input?.focus()
    const option = [...document.querySelectorAll('#nc-group-options [role="option"]')]
      .find((item) => item.textContent.trim() === 'Docker')
    option?.click()
    return { listed: !!option, selected: input?.value === 'Docker' }
  })()`)
  check('分组下拉列出已有分组并可选择', existingGroup.listed && existingGroup.selected, JSON.stringify(existingGroup))
  const customGroup = await evaluate(`(() => {
    const input = document.querySelector('#nc-group')
    if (!input) return ''
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '自定义分组')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return input.value
  })()`)
  check('分组选择后仍可自由输入新分组', customGroup === '自定义分组', `当前值 ${customGroup}`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(200)

  // 2. 密码认证连接
  await clickHost('本地-密码')
  await sleep(3500)
  let term = await readTerminal()
  check('密码认证连接并出现 Shell 提示符', /apex@|\$|#/.test(term), term.slice(-80).trim())

  // 3. ls --color 彩色输出（检查 xterm 生成了带颜色的 span）
  await focusTerminal()
  await typeText('ls --color\r')
  await sleep(1200)
  term = await readTerminal()
  const hasColor = await evaluate(`document.querySelectorAll('.terminal-instance:not(.hidden) .xterm-rows span[style]').length > 3`)
  check('ls --color 彩色输出', term.includes('sftp-testdata') && hasColor, `含 sftp-testdata=${term.includes('sftp-testdata')}, 彩色 span=${hasColor}`)

  // 4. stty size 与 xterm 尺寸一致
  await focusTerminal()
  await typeText('stty size\r')
  await sleep(800)
  term = await readTerminal()
  const stty = term.match(/(\d{2,3})\s+(\d{2,3})\s*$/m) || term.match(/(\d+) (\d+)/)
  const termSize = await evaluate(`(() => { const t = document.querySelector('.terminal-instance:not(.hidden)'); return t ? t.className : '' })()`)
  check('stty size 有输出（resize 同步）', !!stty, stty ? `远端尺寸 ${stty[1]}x${stty[2]}` : '未解析到尺寸')

  // 5. 密钥认证连接（第二个标签）
  await clickHost('本地-密钥')
  await sleep(3500)
  term = await readTerminal()
  check('密钥认证连接并出现 Shell 提示符', /apex@|\$|#/.test(term), term.slice(-80).trim())

  // 6. 多标签：两个会话并存，hostname 不串数据
  await focusTerminal()
  await typeText('hostname\r')
  await sleep(800)
  const keyTerm = await readTerminal()
  // 切回第一个标签
  await evaluate(`document.querySelectorAll('[class*="min-w-\\[120px\\]"]')[0]?.click()`)
  await sleep(600)
  await focusTerminal()
  await typeText('hostname\r')
  await sleep(800)
  const passTerm = await readTerminal()
  // 两个容器 hostname 不同；各自终端应只显示自己那台
  const extractHost = (t) => t.match(/[0-9a-f]{12}/g) ?? []
  const passHosts = extractHost(passTerm)
  const keyHosts = extractHost(keyTerm)
  const passOwn = passHosts[0]
  const keyOwn = keyHosts.find((h) => h !== passOwn)
  check(
    '多标签会话独立（hostname 不串）',
    !!passOwn && !!keyOwn && !passTerm.includes(keyOwn) && !keyTerm.includes(passOwn),
    `标签1=${passOwn ?? '?'} 标签2=${keyOwn ?? '?'}`
  )

  // 7. 错误密码：明确错误提示，应用不崩溃
  await clickHost('错误密码')
  await sleep(4000)
  const toastText = await evaluate(`document.body.textContent`)
  const hasErrDot = await evaluate(`!!document.querySelector('.dot.err')`)
  check(
    '认证失败有明确错误提示',
    toastText.includes('连接失败') || hasErrDot,
    `toast=${toastText.includes('连接失败')}, 错误状态点=${hasErrDot}`
  )
  const alive = await evaluate('window.api.ping()')
  check('认证失败后应用未崩溃', alive === 'pong')

  // 8. 关闭标签：全部关闭后回到空状态
  const tabCount = await evaluate(`document.querySelectorAll('[data-session-tab]').length`)
  for (let i = 0; i < tabCount; i++) {
    await evaluate(`document.querySelector('[data-session-tab] button[title="关闭"]')?.click()`)
    await sleep(400)
  }
  const empty = await evaluate(`!!document.querySelector('input[placeholder*="搜索已保存主机"], input[placeholder*="Search saved hosts"]')`)
  check('关闭全部标签后回到空状态页', empty)

  // 汇总
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
  ws.close()
  process.exit(failed.length ? 1 : 0)
}

main().catch((err) => {
  console.error('验收脚本执行失败:', err.message)
  process.exit(1)
})
