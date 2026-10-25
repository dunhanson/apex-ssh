const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { _electron: electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

async function main() {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-home-'))
  const hosts = [
    { id: 'local', label: 'apex@127.0.0.1', host: '127.0.0.1', port: 2222, username: 'apex', auth: { type: 'password', password: 'apex123' } },
    { id: 'lan', label: 'dunhanson@192.168.1.27', host: '192.168.1.27', port: 22, username: 'dunhanson', auth: { type: 'password' } },
    { id: 'long', label: '用于验证超长主机名称是否会挤出连接启动器的测试记录'.repeat(3), description: '仅用于隔离界面的说明提示验证', host: 'long-address.example.invalid', port: 22, username: 'root', auth: { type: 'password' } }
  ]
  await fs.writeFile(path.join(userData, 'apex-config.json'), JSON.stringify({ hosts, groups: [], recents: hosts.map(h => ({ hostId: h.id, ...h, connectedAt: Date.now() })) }))
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const launch = () => electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '..'), '--user-data-dir=' + userData], env })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.locator('.launcher-host').first().waitFor()
    await page.evaluate(() => document.fonts.ready)
    const input = page.locator('.launcher-search input')
    for (const width of [1280, 480, 360]) {
      await app.evaluate(({ BrowserWindow }, width) => { const w = BrowserWindow.getAllWindows()[0]; w.setMinimumSize(300, 400); w.setContentSize(width, 720) }, width)
      await page.waitForTimeout(150)
      const metrics = await page.locator('.launcher-card').evaluate(el => {
        const rect = el.getBoundingClientRect(); const search = el.querySelector('.launcher-search').getBoundingClientRect()
        return { width: rect.width, left: rect.left, right: rect.right, searchHeight: search.height, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
      })
      assert.ok(Math.abs(metrics.width - Math.min(512, width - 32)) <= 1)
      assert.equal(metrics.searchHeight, 42)
      assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1)
      assert.ok(metrics.left >= 15 && metrics.right <= width - 15)
      await page.screenshot({ path: path.join(userData, width + '-首页.png'), scale: 'css' })
      await input.fill('192.168'); assert.equal(await page.locator('.launcher-host').count(), 1)
      await page.screenshot({ path: path.join(userData, width + '-匹配.png'), scale: 'css' })
      await input.fill('root@new.example.invalid'); assert.equal(await page.locator('.launcher-host').count(), 0)
      await page.screenshot({ path: path.join(userData, width + '-无匹配.png'), scale: 'css' })
      await input.fill('')
      console.log({ width, ...metrics })
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 720))
    await page.locator('.launcher-heading button').click(); await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape')
    await page.getByRole('combobox', { name: '连接协议' }).click()
    await page.getByRole('option', { name: 'sftp', exact: true }).click()
    await input.fill('root@new.example.invalid'); await input.press('Enter')
    const dialog = page.getByRole('dialog'); await dialog.waitFor()
    assert.ok(await dialog.locator('input').evaluateAll(els => els.some(el => el.value === 'new.example.invalid')))
    assert.ok(await dialog.locator('input').evaluateAll(els => els.some(el => el.value === 'root')))
    await page.keyboard.press('Escape')
    await input.fill('')
    await page.locator('.launcher-tool').first().click(); await dialog.waitFor(); await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '配置和连接', exact: true }).click(); await dialog.waitFor(); await page.keyboard.press('Escape')
    // 仅连接本机验证服务，不访问示例公网/内网主机。
    if (process.env.APEX_HOME_REAL_SSH === '1') {
      await page.locator('.launcher-host').first().click()
      await page.getByRole('button', { name: '隐藏 SFTP 面板', exact: true }).waitFor({ timeout: 20000 })
      await page.getByRole('button', { name: '刷新', exact: true }).waitFor()
      await page.waitForFunction(() => [...document.querySelectorAll('input')].some(el => el.value.startsWith('/')), { timeout: 20000 })
      await page.getByText('加载中...', { exact: true }).waitFor({ state: 'hidden' })
      await page.screenshot({ path: path.join(userData, 'SFTP连接.png'), scale: 'css' })
    }
    assert.deepEqual(errors, [])
    await app.close(); app = await launch(); page = await app.firstWindow()
    await page.locator('.launcher-host').first().waitFor()
    assert.equal(await page.locator('.launcher-host').count(), 3)
    console.log('首页布局、搜索、入口、地址预填、协议选择和重启记录验证通过。截图：' + userData)
  } finally { await app.close() }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
