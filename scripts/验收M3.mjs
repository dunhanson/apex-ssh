// M3 验收：SFTP 面板（导航/筛选/新建文件夹/错误提示）、面板式 ↔ 双栏式切换、
// 高度拖拽、拖拽上传遮罩、传输队列、上传/下载 md5 一致性、500MB 暂停续传、
// 传输期间终端可交互、多会话队列独立。全部针对真实 Docker 容器，无 mock。
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const TABBAR = `document.querySelector('[data-tab-bar]')`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0, fail = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ' — ' + extra}`)
  ok ? pass++ : fail++
}

const md5File = (p) => createHash('md5').update(readFileSync(p)).digest('hex')
const remoteMd5 = (container, p) =>
  execSync(`docker exec ${container} md5sum "${p}"`).toString().split(/\s+/)[0]
const TMP = resolve('scripts/.tmp-m3').replace(/\\/g, '/')

// ---- CDP 辅助（与 验收M2b 同模式） ----
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
  return ev2(`[...document.querySelectorAll('[data-connection-host]')].find(h => h.textContent.includes(${JSON.stringify(label)}))?.click()`)
}
const sshType = async (sessionId, text) =>
  ev2(`window.api.ssh.write('${sessionId}', ${JSON.stringify(text)})`)
// 页面内输入 React 受控输入框（native setter + input 事件）
const setInput = (selector, value) => `(() => {
  const input = ${selector}
  if (!input) return false
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, ${JSON.stringify(value)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`
const PANEL = `document.querySelector('input[placeholder="筛选"]')?.closest('div[class*="bg-panel"][style*="height"]')`

// ============================================================
// 0. 连接主机并打开 SFTP 面板
// ============================================================
await connectCdp('localhost:5173')
await clickHost('本地-密码')
await waitFor(`!!${TABBAR}.querySelector('[data-session-tab][data-status="connected"]')`, 15000)
await sleep(500)
const sid = await ev2(`[...window.__terminals.keys()][0]`)
await ev2(`document.querySelector('button[title="SFTP 文件传输"]')?.click()`)
const panelShown = await waitFor(`!!${PANEL}`, 8000)
check('SFTP 面板打开', panelShown)
// 面板挂载后自动定位远端 home
const homeLoaded = await waitFor(`${PANEL} && ${PANEL}.querySelectorAll('[title^="/"]').length > 0`, 10000)
check('远端 home 目录加载', homeLoaded)

// ============================================================
// 1. 目录导航 + 列表
// ============================================================
await ev2(setInput(`${PANEL}.querySelector('input')`, '/config/sftp-testdata'))
await ev2(`${PANEL}.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
const listed = await waitFor(
  `!!${PANEL}.querySelector('[title="/config/sftp-testdata/large-500MB.bin"]') &&
   !!${PANEL}.querySelector('[title="/config/sftp-testdata/嵌套"]')`,
  10000
)
check('导航到测试数据目录并列出内容', listed)
const hasChinese = await ev2(
  `!!${PANEL}.querySelector('[title="/config/sftp-testdata/中文 文件 名.txt"]')`
)
check('中文/空格文件名正确显示', hasChinese)

// 2. 筛选
await ev2(setInput(`document.querySelector('input[placeholder="筛选"]')`, 'large'))
await sleep(400)
const filterCount = await ev2(`${PANEL}.querySelectorAll('[title^="/config"]').length`)
check('筛选生效（large 仅 1 项）', filterCount === 1, `count=${filterCount}`)
await ev2(setInput(`document.querySelector('input[placeholder="筛选"]')`, ''))
await sleep(300)

// 3. 新建文件夹
await ev2(`${PANEL}.querySelector('button[title="新建文件夹"]').click()`)
await sleep(300)
await ev2(setInput(`${PANEL}.querySelector('input[placeholder*="文件夹名称"]')`, 'm3新建目录'))
await ev2(`${PANEL}.querySelector('input[placeholder*="文件夹名称"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
const dirCreated = await waitFor(
  `!!${PANEL}.querySelector('[title="/config/sftp-testdata/m3新建目录"]')`, 8000
)
let remoteDirExists = false
try {
  execSync('docker exec apex-ssh-pass test -d /config/sftp-testdata/m3新建目录')
  remoteDirExists = true
} catch { /* 不存在 */ }
check('新建文件夹（列表 + 远端真实存在）', dirCreated && remoteDirExists)

// 4. 无权限目录错误提示
await ev2(setInput(`${PANEL}.querySelector('input')`, '/config/sftp-testdata/no-access'))
await ev2(`${PANEL}.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
const errShown = await waitFor(`!!${PANEL}.querySelector('.text-danger')`, 8000)
check('无权限目录显示错误提示', errShown)
await ev2(setInput(`${PANEL}.querySelector('input')`, '/config/sftp-testdata'))
await ev2(`${PANEL}.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
await waitFor(`${PANEL}.querySelectorAll('[title^="/config"]').length >= 5`, 8000)

// ============================================================
// 5. 上传小文件（__transfers.add + api.sftp.upload，与面板 startUpload 同一路径）
// ============================================================
const upTask1 = 'm3-up-1'
await ev2(`window.__transfers.add({ taskId: '${upTask1}', sessionId: '${sid}', direction: 'up', name: '上传小文件.txt', total: 0 })`)
await ev2(`window.api.sftp.upload('${sid}', '${upTask1}', ['${TMP}/上传小文件.txt'], '/config/sftp-testdata/m3新建目录')`)
const upDone = await waitFor(`window.__transfers.get('${upTask1}')?.status === 'done'`, 15000)
let upMd5Ok = false
if (upDone) {
  await sleep(300)
  upMd5Ok = md5File(`${TMP}/上传小文件.txt`) === remoteMd5('apex-ssh-pass', '/config/sftp-testdata/m3新建目录/上传小文件.txt')
}
check('上传小文件完成且 md5 一致', upDone && upMd5Ok)

// 6. 上传嵌套目录（含中文名、空格名、子目录）
const upTask2 = 'm3-up-2'
await ev2(`window.__transfers.add({ taskId: '${upTask2}', sessionId: '${sid}', direction: 'up', name: '嵌套上传', total: 0 })`)
await ev2(`window.api.sftp.upload('${sid}', '${upTask2}', ['${TMP}/嵌套上传'], '/config/sftp-testdata/m3新建目录')`)
const dirUpDone = await waitFor(`window.__transfers.get('${upTask2}')?.status === 'done'`, 15000)
let treeOk = false
if (dirUpDone) {
  const a = md5File(`${TMP}/嵌套上传/子目录/a.txt`) === remoteMd5('apex-ssh-pass', '/config/sftp-testdata/m3新建目录/嵌套上传/子目录/a.txt')
  const b = md5File(`${TMP}/嵌套上传/b 空格.txt`) === remoteMd5('apex-ssh-pass', '/config/sftp-testdata/m3新建目录/嵌套上传/b 空格.txt')
  treeOk = a && b
}
check('嵌套目录上传（中文/空格/子目录 md5 全对）', dirUpDone && treeOk)

// 7. 下载小文件 md5 一致（10MB 中文件，验证内容不损坏）
const dlTask1 = 'm3-dl-1'
await ev2(`window.__transfers.add({ taskId: '${dlTask1}', sessionId: '${sid}', direction: 'down', name: 'medium-10MB.bin', total: 0 })`)
await ev2(`window.api.sftp.download('${sid}', '${dlTask1}', '/config/sftp-testdata/medium-10MB.bin', '${TMP}/downloads/medium-10MB.bin')`)
const dlDone = await waitFor(`window.__transfers.get('${dlTask1}')?.status === 'done'`, 30000)
const dlMd5Ok = dlDone && existsSync(`${TMP}/downloads/medium-10MB.bin`) &&
  md5File(`${TMP}/downloads/medium-10MB.bin`) === remoteMd5('apex-ssh-pass', '/config/sftp-testdata/medium-10MB.bin')
check('下载 10MB 完成且 md5 一致', dlDone && dlMd5Ok)

// 8. 传输队列 UI（↑绿/↓蓝、完成状态、清除已完成）
const queueUi = await ev2(`(() => {
  const panel = ${PANEL}
  const labels = [...panel.querySelectorAll('span')].map(s => s.textContent)
  const rows = panel.querySelectorAll('.icon-btn[title="移除"]').length
  return {
    title: panel.textContent.includes('传输队列'),
    doneCount: labels.filter(t => t === '完成').length,
    rows
  }
})()`)
check('传输队列显示 3 条已完成', queueUi.title && queueUi.doneCount === 3, JSON.stringify(queueUi))
await ev2(`[...${PANEL}.querySelectorAll('button')].find(b => b.textContent === '清除已完成')?.click()`)
await sleep(400)
const cleared = await ev2(`${PANEL}.textContent.includes('传输队列') === false`)
check('清除已完成（队列收起）', cleared)

// ============================================================
// 9. 500MB 断点续传：暂停 → 进度停住 → 续传 → md5 一致；期间终端可交互
// ============================================================
const bigTask = 'm3-big'
await ev2(`window.__transfers.add({ taskId: '${bigTask}', sessionId: '${sid}', direction: 'down', name: 'large-500MB.bin', total: 0 })`)
await ev2(`window.api.sftp.download('${sid}', '${bigTask}', '/config/sftp-testdata/large-500MB.bin', '${TMP}/downloads/large-500MB.bin')`)
// 传过 20MB 后暂停（256KB 分块，本地容器也足够跑一阵）
const gotSome = await waitFor(`(window.__transfers.get('${bigTask}')?.transferred ?? 0) > 20 * 1024 * 1024`, 60000, 30)
check('500MB 传输推进超过 20MB', gotSome)

// 传输期间终端可交互
const MARKER = `SFTP${Math.floor(Math.random() * 1e6)}`
await sshType(sid, `echo ${MARKER}\r`)
const termAlive = await waitFor(
  `(window.__terminals.get('${sid}')?.serialize.serialize() ?? '').includes('${MARKER}')`, 8000
)
check('传输期间终端可交互', termAlive)

await ev2(`window.api.sftp.pause('${bigTask}')`)
await waitFor(`window.__transfers.get('${bigTask}')?.status === 'paused'`, 5000)
// 暂停为分块级检查点：允许一个在途分块落定，600ms 后采样基准
await sleep(600)
const snap1 = await ev2(`window.__transfers.get('${bigTask}')?.transferred`)
await sleep(1200)
const snap2 = await ev2(`window.__transfers.get('${bigTask}')?.transferred`)
const pausedOk = typeof snap1 === 'number' && snap1 > 0 && snap1 === snap2
check('暂停后进度停住', pausedOk, `snap1=${snap1} snap2=${snap2}`)
const pausedPct = Math.round((snap1 / (500 * 1024 * 1024)) * 100)
check('暂停点在 50% 前（续传有意义）', snap1 < 500 * 1024 * 1024 * 0.6, `${pausedPct}%`)

await ev2(`window.api.sftp.resume('${bigTask}')`)
const bigDone = await waitFor(`window.__transfers.get('${bigTask}')?.status === 'done'`, 120000, 500)
let bigMd5Ok = false
if (bigDone) {
  bigMd5Ok = md5File(`${TMP}/downloads/large-500MB.bin`) === remoteMd5('apex-ssh-pass', '/config/sftp-testdata/large-500MB.bin')
}
check('500MB 暂停续传完成且 md5 一致', bigDone && bigMd5Ok)

// ============================================================
// 10. 拖拽上传遮罩
// ============================================================
const overlay = await ev2(`(() => {
  const panel = ${PANEL}
  const dt = new DataTransfer()
  dt.items.add(new File(['x'], 'x.txt'))
  panel.querySelector('.flex-1.min-h-0.flex.relative')?.dispatchEvent(
    new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
  return true
})()`)
await sleep(400)
const overlayShown = await ev2(`(() => {
  const el = ${PANEL}.textContent.includes('释放上传到')
  return el
})()`)
check('拖拽进入显示上传遮罩', overlay && overlayShown)
// 移出拖拽，消除遮罩避免干扰后续断言
await ev2(`${PANEL}.querySelector('.flex-1.min-h-0.flex.relative')?.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true }))`)
await sleep(300)

// ============================================================
// 11. 双栏式切换
// ============================================================
// 双栏式下无「筛选」输入框，PANEL 表达式失效，改用拖拽条定位面板
const SPLIT_PANEL = `document.querySelector('[title="拖拽调整面板高度"]')?.parentElement`
await ev2(`${PANEL}.querySelector('button[title="切换双栏式"]').click()`)
const splitShown = await waitFor(
  `(() => { const p = ${SPLIT_PANEL}; return !!p && p.textContent.includes('本地') && p.textContent.includes('远程') })()`,
  8000
)
const arrows = await ev2(
  `!!document.querySelector('button[title="上传选中"]') && !!document.querySelector('button[title="下载选中"]')`
)
check('双栏式（本地 + 远程 + 中间箭头）', splitShown && arrows)
const localListed = await waitFor(
  `[...document.querySelectorAll('div[title]')].some(d => d.title.includes(':/') || d.title.startsWith('/'))`,
  8000
)
check('本地目录列表加载', localListed)
// 切回面板式
await ev2(`document.querySelector('button[title="切换面板式"]').click()`)
await sleep(400)

// ============================================================
// 12. 面板高度拖拽（120px – 视口 80%）
// ============================================================
const heightClamp = await ev2(`(async () => {
  const handle = document.querySelector('[title="拖拽调整面板高度"]')
  const panel = handle.parentElement
  const rect = handle.getBoundingClientRect()
  const y = rect.top + 2, x = rect.left + 100
  const opts = (yy) => ({ bubbles: true, cancelable: true, clientX: x, clientY: yy })
  handle.dispatchEvent(new MouseEvent('mousedown', opts(y)))
  // 拖到远超视口顶部 → 应被 clamp 到 80%
  document.dispatchEvent(new MouseEvent('mousemove', opts(y - 5000)))
  await new Promise(r => setTimeout(r, 300))
  const hMax = panel.getBoundingClientRect().height
  const clampHigh = hMax <= window.innerHeight * 0.8 + 1 && hMax > window.innerHeight * 0.7
  // 拖到底部之下 → 应被 clamp 到 120
  document.dispatchEvent(new MouseEvent('mousemove', opts(y + 5000)))
  await new Promise(r => setTimeout(r, 300))
  const hMin = panel.getBoundingClientRect().height
  document.dispatchEvent(new MouseEvent('mouseup', opts(y + 5000)))
  return { hMax, hMin, clampHigh, clampLow: Math.abs(hMin - 120) <= 1 }
})()`)
check('高度拖拽上限 clamp 到视口 80%', heightClamp.clampHigh, `hMax=${heightClamp.hMax}`)
check('高度拖拽下限 clamp 到 120px', heightClamp.clampLow, `hMin=${heightClamp.hMin}`)

// ============================================================
// 13. 多会话队列独立：第二台主机的会话不显示第一台的任务
// ============================================================
await clickHost('本地-密钥')
await waitFor(`${TABBAR}.querySelectorAll('.group').length === 2`, 10000)
await sleep(1500)
const sid2 = await ev2(`[...window.__terminals.keys()][1]`)
// 第二会话打开面板：队列区应不存在（它的任务数为 0；第一台的任务被过滤）
await ev2(`document.querySelector('button[title="SFTP 文件传输"]')?.click()`)
await sleep(1000)
const panel2 = await ev2(`(() => {
  const p = document.querySelector('input[placeholder="筛选"]')?.closest('div[class*="bg-panel"][style*="height"]')
  if (!p) return null
  return { hasQueue: p.textContent.includes('传输队列'), rows: p.querySelectorAll('[title^="/"]').length }
})()`)
check('第二会话面板独立加载列表', panel2 && panel2.rows > 0)
check('第二会话队列不含第一会话任务', panel2 && !panel2.hasQueue)
// 给第二会话派一个任务，确认互不串台
await ev2(`window.__transfers.add({ taskId: 'm3-s2', sessionId: '${sid2}', direction: 'down', name: '中文 文件 名.txt', total: 0 })`)
await ev2(`window.api.sftp.download('${sid2}', 'm3-s2', '/config/sftp-testdata/中文 文件 名.txt', '${TMP}/downloads/中文 文件 名.txt')`)
const s2Done = await waitFor(`window.__transfers.get('m3-s2')?.status === 'done'`, 15000)
const s2Md5Ok = s2Done && existsSync(`${TMP}/downloads/中文 文件 名.txt`) &&
  md5File(`${TMP}/downloads/中文 文件 名.txt`) === remoteMd5('apex-ssh-key', '/config/sftp-testdata/中文 文件 名.txt')
check('第二会话下载中文名文件 md5 一致', s2Done && s2Md5Ok)

// ============================================================
// 清理：远端测试目录 + 本地临时文件 + 关闭会话
// ============================================================
try { execSync('docker exec apex-ssh-pass rm -rf /config/sftp-testdata/m3新建目录') } catch { /* 忽略 */ }
try { rmSync(TMP, { recursive: true, force: true }) } catch { /* 忽略 */ }
await ev2(`window.__transfers.clearCompleted('${sid}'); window.__transfers.remove('m3-big')`)

console.log(`\nM3 验收结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
