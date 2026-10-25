const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { _electron: electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

async function main() {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-terminal-'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const launch = () => electron.launch({
    executablePath: require('electron'),
    args: [path.resolve(__dirname, '..'), '--user-data-dir=' + userData],
    env
  })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('tab', { name: '终端', exact: true }).click()
    await page.evaluate(() => document.fonts.ready)
    const switchGeometry = await page.locator('.terminal-settings [data-slot="switch-thumb"]').first().evaluate(el => {
      const thumb = el.getBoundingClientRect()
      const track = el.parentElement.getBoundingClientRect()
      return { thumbWidth: thumb.width, trackWidth: track.width, offset: thumb.x - track.x }
    })
    assert.deepEqual(switchGeometry, { thumbWidth: 14, trackWidth: 36, offset: 19 })
    await page.mouse.move(0, 0)
    for (const width of [1280, 480, 360]) {
      await app.evaluate(({ BrowserWindow }, width) => {
        const win = BrowserWindow.getAllWindows()[0]
        win.setMinimumSize(300, 400)
        win.setContentSize(width, 720)
      }, width)
      await page.waitForTimeout(200)
      const viewport = page.locator('.settings-workspace-content')
      await viewport.evaluate(el => { el.scrollTop = 0 })
      const metrics = await viewport.evaluate(el => ({
        width: el.clientWidth, scrollWidth: el.scrollWidth,
        height: el.clientHeight, scrollHeight: el.scrollHeight
      }))
      assert.ok(metrics.scrollWidth <= metrics.width + 1, '正文横向溢出')
      assert.ok(metrics.scrollHeight > metrics.height, '终端长内容应可滚动')
      await page.screenshot({ path: path.join(userData, width + '-top.png'), scale: 'css' })
      await viewport.evaluate(el => { el.scrollTop = el.scrollHeight })
      await page.screenshot({ path: path.join(userData, width + '-bottom.png'), scale: 'css' })
      console.log({ viewportWidth: width, ...metrics })
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 720))
    await page.locator('.settings-workspace-content').evaluate(el => { el.scrollTop = 0 })
    const initial = await page.evaluate(() => window.api.settings.get())
    await page.locator('.terminal-font-stepper button').last().click()
    await page.waitForFunction(size => document.querySelector('.terminal-font-stepper output')?.textContent === String(size), initial.fontSize + 0.5)
    await page.locator('#settings-scrollback').click()
    await page.getByRole('option', { name: '10,000 行', exact: true }).click()
    await page.getByRole('switch', { name: '光标闪烁', exact: true }).click()
    await page.waitForFunction(async () => (await window.api.settings.get()).cursorBlink === false)
    const changed = await page.evaluate(() => window.api.settings.get())
    assert.equal(changed.fontSize, initial.fontSize + 0.5)
    assert.equal(changed.scrollback, 10000)
    assert.equal(changed.cursorBlink, false)
    await page.evaluate(() => window.api.settings.set({ scrollback: 7500, fontSize: 12.5 }))
    await page.waitForFunction(() => document.querySelector('.terminal-font-stepper button')?.disabled)
    assert.match(await page.locator('#settings-scrollback').innerText(), /7,500/)
    await page.evaluate(() => window.api.settings.set({ fontSize: 24 }))
    await page.waitForFunction(() => document.querySelector('.terminal-font-stepper button:last-child')?.disabled)
    assert.deepEqual(errors, [])
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    const saved = await page.evaluate(() => window.api.settings.get())
    assert.equal(saved.fontSize, 24)
    assert.equal(saved.scrollback, 7500)
    assert.equal(saved.cursorBlink, false)
    console.log('终端布局、交互、边界、自定义值兼容及重启持久化通过。截图：' + userData)
  } finally {
    await app.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
