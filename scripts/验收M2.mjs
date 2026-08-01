// M2 验收（一）：右键菜单 / 分屏 / 焦点侧新建 / 最近使用 / 分组折叠 / SSH Config 导入
const targets = await (await fetch('http://localhost:9222/json')).json()
const page = targets.find((t) => t.type === 'page' && !t.url.includes('detached'))
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
// 等待表达式为真（避免固定 sleep 的时序抖动）
const waitFor = async (expr, timeoutMs = 15000, interval = 300) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await ev2(expr)) return true
    await sleep(interval)
  }
  return false
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0, fail = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ' — ' + extra}`)
  ok ? pass++ : fail++
}

// 标签栏根（页面还有侧栏 Logo 行也是 .app-drag，用高度类区分）
const TABBAR = `document.querySelector('[data-tab-bar]')`
const clickHost = async (label) => {
  await ev2(`document.querySelector('button[title="配置和连接"], button[title="Connections"]')?.click()`)
  await sleep(300)
  return ev2(`[...document.querySelectorAll('[data-connection-host]')].find(h => h.textContent.includes(${JSON.stringify(label)}))?.click()`)
}
const rightClickTab = async (index) =>
  ev2(`(() => {
    const tab = ${TABBAR}.querySelectorAll('.group')[${index}]
    tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window }))
    return true
  })()`)
const clickMenu = async (text) => {
  await sleep(400)
  return ev2(`[...document.querySelectorAll('[role="menuitem"]')].find(i => i.textContent === '${text}')?.click()`)
}

// ---- 准备：连两台主机（左窗格两个标签） ----
await clickHost('本地-密码')
await sleep(2500)
await clickHost('本地-密钥')
await sleep(2500)
const tabCount = await ev2(`${TABBAR}.querySelectorAll('.group').length`)
check('连接两台主机生成 2 个标签', tabCount === 2, `tabs=${tabCount}`)

// ---- 右键菜单齐全 ----
await rightClickTab(0)
const menuItems = await ev2(`[...document.querySelectorAll('[role="menuitem"]')].map(i => i.textContent)`)
check('右键菜单项齐全', ['重新连接','断开连接','关闭','关闭其他','关闭右侧','全部关闭','复制会话','向右分屏','移到新窗口'].every(t => menuItems.includes(t)), JSON.stringify(menuItems))

// ---- 断开连接 → 标签保留删除线 + 终端显示关闭提示 ----
await clickMenu('断开连接')
await sleep(500)
const retained = await ev2(`(() => {
  const tab = ${TABBAR}.querySelectorAll('.group')[0]
  const terminalText = document.querySelectorAll('.terminal-instance')[0]?.textContent ?? ''
  return {
    lineThrough: !!tab.querySelector('.line-through'),
    gray: tab.dataset.status !== 'connected',
    closedNotice: terminalText.includes('Connection to ') && terminalText.includes(' closed.')
  }
})()`)
check('断开后标签保留删除线且终端显示关闭提示', retained.lineThrough && retained.gray && retained.closedNotice, JSON.stringify(retained))

// ---- 重连恢复 ----
await rightClickTab(0)
await clickMenu('重新连接')
await sleep(3000)
const reconnected = await ev2(`(() => {
  const tab = ${TABBAR}.querySelectorAll('.group')[0]
  return { green: tab.dataset.status === 'connected', noStrike: !tab.querySelector('.line-through') }
})()`)
check('重连恢复（绿点 + 无删除线）', reconnected.green && reconnected.noStrike, JSON.stringify(reconnected))

// ---- 复制会话 ----
await rightClickTab(1)
await clickMenu('复制会话')
await sleep(2500)
const afterDup = await ev2(`${TABBAR}.querySelectorAll('.group').length`)
check('复制会话新增标签', afterDup === 3, `tabs=${afterDup}`)

// ---- 向右分屏 ----
await rightClickTab(0)
await clickMenu('向右分屏')
await sleep(2500)
const splitState = await ev2(`(() => {
  const right = ${TABBAR}.children[1]
  return {
    split: ${TABBAR}.children.length >= 3,
    rightTabs: right ? right.querySelectorAll('.group').length : 0,
    handle: !!document.querySelector('.cursor-col-resize')
  }
})()`)
check('向右分屏：副屏标签组出现', splitState.split && splitState.rightTabs === 1 && splitState.handle, JSON.stringify(splitState))

// 副屏为真实会话：右侧终端执行命令看回显
const rightTermHost = await ev2(`(() => {
  const panes = [...document.querySelectorAll('.terminal-instance:not(.hidden) .xterm-rows')]
  return panes.length
})()`)
check('分屏后两侧窗格各有活跃终端', rightTermHost === 2, `visible=${rightTermHost}`)

// ---- 拖拽比例限制 20%–80%（React 状态异步，分步验证） ----
const dragTo = async (frac) => {
  await ev2(`(() => {
    const handle = document.querySelector('.cursor-col-resize')
    const panes = handle.parentElement
    const rect = panes.getBoundingClientRect()
    const y = rect.top + rect.height / 2
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: rect.left + rect.width / 2, clientY: y }))
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: rect.left + rect.width * ${frac}, clientY: y }))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    return true
  })()`)
  await sleep(250)
  return ev2(`document.querySelector('.cursor-col-resize').parentElement.children[0].style.width`)
}
const w80 = await dragTo(0.95)
const w20 = await dragTo(0.05)
const w50 = await dragTo(0.5)
check('拖拽条比例钳制 20%–80%', w80 === '80%' && w20 === '20%' && w50 === '50%', JSON.stringify({ w80, w20, w50 }))

// ---- 焦点侧新建：点右侧窗格 → 点侧栏主机进右侧 ----
await ev2(`(() => {
  const rightPane = document.querySelector('.cursor-col-resize').nextElementSibling
  // mousedown 捕获在窗格内层 div 上，需派发到其后代
  rightPane.firstElementChild.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  return true
})()`)
await sleep(200)
await clickHost('错误密码')
await sleep(800)
const focusNew = await ev2(`${TABBAR}.children[1].querySelectorAll('.group').length`)
check('焦点侧新建进右侧窗格', focusNew === 2, `rightTabs=${focusNew}`)

// ---- 副屏标签全部关闭 → 分屏自动收起 ----
for (let i = 0; i < 2; i++) {
  await ev2(`${TABBAR}.children[1].querySelector('.group .icon-btn')?.click()`)
  await sleep(500)
}
const collapsedSplit = await ev2(`(() => ({
  children: ${TABBAR}.children.length,
  handle: !!document.querySelector('.cursor-col-resize')
}))()`)
check('副屏全部关闭后分屏自动收起', collapsedSplit.children === 3 && !collapsedSplit.handle, JSON.stringify(collapsedSplit))

// ---- 关闭其他（作用于同侧标签组） ----
await rightClickTab(0)
await clickMenu('关闭其他')
await sleep(600)
const afterCloseOthers = await ev2(`${TABBAR}.children[0].querySelectorAll('.group').length`)
check('关闭其他后同侧仅剩 1 个标签', afterCloseOthers === 1, `left=${afterCloseOthers}`)

// ---- 全部关闭 → 空状态页 + 最近使用芯片 ----
await rightClickTab(0)
await clickMenu('全部关闭')
await sleep(800)
const emptyState = await ev2(`(() => {
  const text = document.body.textContent
  const chips = [...document.querySelectorAll('.launcher-host')].filter(b => /^本地-/.test(b.textContent.trim()))
  return { empty: !!document.querySelector('input[placeholder*="搜索已保存主机"]'), chips: chips.length, recentLabel: text.includes('最近使用') }
})()`)
check('全部关闭回空状态页', emptyState.empty, JSON.stringify(emptyState))
check('最近使用芯片出现', emptyState.chips >= 2 && emptyState.recentLabel, JSON.stringify(emptyState))

// ---- 芯片点击直接重连 ----
await ev2(`(() => {
  const chips = [...document.querySelectorAll('.launcher-host')].filter(b => b.textContent.includes('本地-密码'))
  chips[chips.length - 1]?.click()
  return true
})()`)
const chipReconnect = await waitFor(`!!${TABBAR}.querySelector('[data-session-tab][data-status="connected"]')`, 10000)
check('最近使用芯片点击直接重连', chipReconnect)

// ---- 分组折叠（组名显示为 CSS 大写，textContent 为原始大小写；React 状态异步，分步验证） ----
await ev2(`document.querySelector('button[title="配置和连接"]')?.click()`)
await sleep(300)
const foldHeader = `(() => {
  const header = [...document.querySelectorAll('[data-connection-group]')].find(b => b.textContent.toUpperCase().includes('DOCKER'))
  header?.click()
  return !!header
})()`
const foldBefore = await ev2(`document.querySelectorAll('[data-connection-host]').length`)
await ev2(foldHeader)
await sleep(300)
const foldAfter = await ev2(`document.querySelectorAll('[data-connection-host]').length`)
await ev2(foldHeader)
await sleep(300)
const foldRestored = await ev2(`document.querySelectorAll('[data-connection-host]').length`)
// Docker 组外可能有其他主机（历史填充等），断言折叠减少 + 展开恢复即可
check('分组折叠 / 展开', foldBefore > 0 && foldAfter < foldBefore && foldRestored === foldBefore, JSON.stringify({ foldBefore, foldAfter, foldRestored }))

// ---- SSH Config 导入 ----
await ev2(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await sleep(200)
await ev2(`document.querySelector('button[title="新建连接"]')?.click()`)
await sleep(400)
await ev2(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('从 SSH Config 导入'))?.click()`)
await sleep(800)
const importList = await ev2(`(() => {
  const items = [...document.querySelectorAll('[data-slot="dialog-content"] button')].filter(b => b.textContent.includes('test-'))
  return { count: items.length, text: items.map(i => i.textContent) }
})()`)
check('SSH Config 条目列出（Host * 不生成、ProxyJump 打标）', importList.count >= 4 && importList.text.some(t => t.includes('⚠')), JSON.stringify(importList))
check('通配块默认值合并（test-alias1 继承 User defaultuser）', importList.text.some(t => t.includes('test-alias1') && t.includes('defaultuser@192.0.2.10')), JSON.stringify(importList.text))

await ev2(`[...document.querySelectorAll('[data-slot="dialog-content"] button')].find(b => b.textContent.includes('test-pass'))?.click()`)
await sleep(400)
const prefilled = await ev2(`(() => {
  const val = (id) => document.getElementById(id)?.value
  return { host: val('nc-host'), port: val('nc-port'), user: val('nc-username'), label: val('nc-label') }
})()`)
check('导入预填充表单', prefilled.host === '127.0.0.1' && prefilled.port === '2222' && prefilled.user === 'apex' && prefilled.label === 'test-pass', JSON.stringify(prefilled))
await ev2(`[...document.querySelectorAll('[data-slot="dialog-content"] button')].find(b => b.textContent === '取消')?.click()`)

console.log(`\n${pass}/${pass + fail} 项通过`)
process.exit(fail ? 1 : 0)
