const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

// 使用外部 Playwright 运行时，不向应用运行依赖引入浏览器测试工具。
const { _electron: electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

async function main() {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-ui-'))
  const output = path.join(userData, 'screenshots')
  await fs.mkdir(output)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [path.resolve(__dirname, '..'), `--user-data-dir=${userData}`],
    env
  })
  try {
    const page = await app.firstWindow()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.locator('.settings-dialog').waitFor()
    const categories = ['终端', '界面', '监控', '传输', '备份', '同步', '关于']
    for (const width of [1280, 480, 360]) {
      await app.evaluate(({ BrowserWindow }, width) => {
        const win = BrowserWindow.getAllWindows()[0]
        win.setMinimumSize(300, 400)
        win.setSize(width, 800)
      }, width)
      for (const name of categories) {
        await page.getByRole('tab', { name, exact: true }).click()
        const geometry = await page.locator('.settings-workspace-content').evaluate(el => ({
          width: el.clientWidth,
          scrollWidth: el.scrollWidth,
          height: el.clientHeight,
          scrollHeight: el.scrollHeight
        }))
        assert.ok(geometry.scrollWidth <= geometry.width + 1, `${width} ${name}: 横向溢出`)
        assert.ok(geometry.height > 0, `${width} ${name}: 正文不可见`)
        await page.screenshot({ path: path.join(output, `${width}-${name}.png`) })
        console.log(JSON.stringify({ viewportWidth: width, name, ...geometry }))
        const close = page.locator('.settings-workspace-header').getByRole('button', { name: '关闭', exact: true })
        assert.equal(await close.count(), 1, '标题栏必须只有一个关闭按钮')
        const closeBox = await close.boundingBox()
        assert.ok(closeBox.x >= 0 && closeBox.x + closeBox.width <= width, '关闭按钮超出窗口')
        await page.locator('.settings-workspace-content').evaluate(el => { el.scrollTop = el.scrollHeight })
        await page.screenshot({ path: path.join(output, `${width}-${name}-bottom.png`) })
        await page.locator('.settings-workspace-content').evaluate(el => { el.scrollTop = 0 })
        if (name === '传输') {
          const sizes = await page.locator('.settings-directory-row').evaluate(el =>
            Array.from(el.children, child => ({ height: child.getBoundingClientRect().height }))
          )
          assert.equal(sizes[0].height, sizes[1].height, '路径框与目录按钮高度不一致')
        }
      }
      await page.getByRole('tab', { name: '同步', exact: true }).click()
      await page.getByRole('button', { name: '保存连接', exact: true }).click()
      const toast = page.locator('[data-sonner-toast]').first()
      await toast.waitFor()
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-sonner-toast]')
        return el?.getAttribute('data-mounted') === 'true'
      })
      await toast.evaluate(async el => {
        await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {})))
      })
      const toastBox = await toast.boundingBox()
      assert.ok(toastBox.x >= 0 && toastBox.x + toastBox.width <= width, '通知超出窗口')
      await page.screenshot({ path: path.join(output, `${width}-toast.png`) })
      await toast.getByRole('button', { name: '关闭', exact: true }).click()
      await toast.waitFor({ state: 'detached' })
    }
    // 仅测试进程发送状态样本；不修改持久化数据、不连接真实数据库。
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
    await page.getByRole('tab', { name: '同步', exact: true }).click()
    for (const state of ['normal', 'error', 'syncing']) {
      await app.evaluate(({ BrowserWindow }, state) => {
        BrowserWindow.getAllWindows()[0].webContents.send('cloud-sync:state-changed', {
          configured: true, enabled: true, hasKey: true,
          syncing: state === 'syncing', syncedHostCount: 12,
          lastSyncAt: Date.parse('2026-08-27T15:20:04+08:00'),
          ...(state === 'error' ? { errorCode: 'connection' } : {})
        })
      }, state)
      await page.locator('.sync-key-badge').getByText('已配置', { exact: true }).waitFor()
      await page.evaluate(() => document.fonts.ready)
      await page.locator('.settings-workspace-content').evaluate(el => { el.scrollTop = el.scrollHeight })
      const metrics = await page.locator('.settings-sync-key-row').evaluate(el => ({
        inputWidth: el.querySelector('input').getBoundingClientRect().width,
        rowWidth: el.getBoundingClientRect().width,
        buttons: Array.from(el.querySelectorAll('button'), button => button.getBoundingClientRect().width)
      }))
      assert.ok(Math.abs(metrics.inputWidth - (metrics.rowWidth - 12) / 2) < 1)
      assert.deepEqual(metrics.buttons, [32, 32])
      await page.screenshot({ path: path.join(output, `1280-sync-${state}.png`), scale: 'css' })
    }
    assert.deepEqual(errors, [], '渲染异常')
    console.log(`截图目录：${output}`)
  } finally {
    await app.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
