const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { _electron: electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

async function checkSwitch(control) {
  await control.page().waitForTimeout(250)
  const metrics = await control.evaluate(el => {
    const track = el.getBoundingClientRect()
    const thumb = el.querySelector('[data-slot="switch-thumb"]').getBoundingClientRect()
    return {
      checked: el.dataset.state === 'checked',
      width: track.width, height: track.height,
      thumbWidth: thumb.width, thumbHeight: thumb.height,
      left: thumb.left - track.left, right: track.right - thumb.right,
      top: thumb.top - track.top, bottom: track.bottom - thumb.bottom
    }
  })
  for (const [key, expected] of Object.entries({
    width: 36, height: 20, thumbWidth: 14, thumbHeight: 14,
    left: metrics.checked ? 19 : 3, right: metrics.checked ? 3 : 19, top: 3, bottom: 3
  })) assert.ok(Math.abs(metrics[key] - expected) < 0.1, key + ': ' + JSON.stringify(metrics))
}

async function main() {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-settings-restored-'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const launch = () => electron.launch({
    executablePath: require('electron'),
    args: [path.resolve(__dirname, '..'), '--user-data-dir=' + userData], env
  })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const viewport = page.locator('.settings-workspace-content')
    const shot = name => page.screenshot({ path: path.join(userData, name + '.png'), scale: 'css' })
    for (const width of [1280, 480, 360]) {
      await app.evaluate(({ BrowserWindow }, width) => {
        const win = BrowserWindow.getAllWindows()[0]
        win.setMinimumSize(300, 400)
        win.setContentSize(width, 720)
      }, width)
      for (const name of ['终端', '界面', '监控', '传输', '备份', '同步', '关于']) {
        await page.getByRole('tab', { name, exact: true }).click()
        await page.mouse.move(0, 0)
        await page.evaluate(() => document.fonts.ready)
        await viewport.evaluate(el => { el.scrollTop = 0 })
        await page.waitForTimeout(100)
        const switches = page.getByRole('switch')
        for (let index = 0; index < await switches.count(); index++) {
          const control = switches.nth(index)
          await checkSwitch(control)
          if (name !== '同步' && await control.isEnabled()) {
            await control.click()
            await checkSwitch(control)
            await control.click()
            await checkSwitch(control)
          }
        }
        if (name === '同步') {
          // 仅注入隔离窗口的展示状态，不启用真实云端同步。
          for (const enabled of [true, false]) {
            await app.evaluate(({ BrowserWindow }, enabled) => {
              BrowserWindow.getAllWindows()[0].webContents.send('cloud-sync:state-changed', {
                configured: true, enabled, hasKey: true, syncing: false, syncedHostCount: 0
              })
            }, enabled)
            const control = page.locator('.sync-enable-row [data-slot="switch"]')
            await page.waitForFunction(enabled => document.querySelector('.sync-enable-row [data-slot="switch"]')?.getAttribute('aria-checked') === String(enabled), enabled)
            await control.scrollIntoViewIfNeeded()
            await checkSwitch(control)
            await shot(width + '-sync-' + (enabled ? 'on' : 'off'))
          }
        }
        await viewport.evaluate(el => { el.scrollTop = 0 })
        if (name === '关于' || name === '备份') {
          const selector = name === '关于' ? '.settings-update-actions' : '.settings-backup-actions'
          const buttons = await page.locator(selector + ' > button').evaluateAll(elements =>
            elements.map(el => ({
              variant: el.dataset.variant,
              background: getComputedStyle(el).backgroundColor,
              color: getComputedStyle(el).color,
              border: getComputedStyle(el).borderTopColor,
              height: el.getBoundingClientRect().height
            }))
          )
          assert.equal(buttons.length, 2)
          for (const button of buttons) {
            assert.equal(button.variant, 'secondary')
            assert.equal(button.background, 'rgb(39, 39, 42)')
            assert.equal(button.color, 'rgb(250, 250, 250)')
            assert.equal(button.border, 'rgb(39, 39, 42)')
            if (name === '关于') assert.ok(Math.abs(button.height - 37.333) < 1)
          }
        }
        const metrics = await viewport.evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth, height: el.clientHeight, scrollHeight: el.scrollHeight }))
        assert.ok(metrics.scrollWidth <= metrics.width + 1, width + name + '横向溢出')
        await shot(width + '-' + name)
        if (metrics.scrollHeight > metrics.height) {
          await viewport.evaluate(el => { el.scrollTop = el.scrollHeight })
          await shot(width + '-' + name + '-bottom')
        }
        console.log({ viewport: width, name, ...metrics })
      }
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 720))
    await page.getByRole('tab', { name: '界面', exact: true }).click()
    await page.getByRole('switch', { name: '紧凑模式', exact: true }).click()
    await page.waitForFunction(() => document.documentElement.dataset.compact === 'true')
    await page.getByRole('switch', { name: '界面动画', exact: true }).click()
    await page.waitForFunction(() => document.documentElement.dataset.motion === 'false')
    await page.getByRole('tab', { name: '监控', exact: true }).click()
    await page.locator('#settings-monitorRefreshInterval').click()
    await page.getByRole('option', { name: '10 秒', exact: true }).click()
    await page.getByRole('switch', { name: '后台自动运行监控', exact: true }).click()
    await page.getByRole('tab', { name: '传输', exact: true }).click()
    await page.getByRole('checkbox', { name: '使用上次下载目录', exact: true }).click()
    assert.equal(await page.getByRole('checkbox', { name: '每次下载前询问保存位置', exact: true }).isChecked(), false)
    await page.getByRole('switch', { name: '显示传输进度', exact: true }).click()
    await page.getByRole('checkbox', { name: '每次下载前询问保存位置', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: '选择目录', exact: true }).isDisabled(), true)
    await page.getByRole('checkbox', { name: '每次下载前询问保存位置', exact: true }).click()
    // 只替换隔离进程的系统选择器返回值，页面仍走真实 IPC 和持久化链路。
    await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }) }, userData)
    await page.getByRole('button', { name: '选择目录', exact: true }).click()
    await page.waitForFunction(dir => document.querySelector('.settings-directory-row input')?.value === dir, userData)
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }) })
    await page.getByRole('button', { name: '选择目录', exact: true }).click()
    assert.equal(await page.locator('.settings-directory-row input').inputValue(), userData)
    await page.getByRole('tab', { name: '备份', exact: true }).click()
    await page.getByRole('button', { name: '导出', exact: true }).click()
    await page.locator('.settings-backup-dialog').waitFor()
    await shot('backup-custom')
    await page.getByRole('radio', { name: '随机密码', exact: true }).click()
    await shot('backup-random')
    await page.locator('.settings-backup-dialog').getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('tab', { name: '关于', exact: true }).click()
    for (const state of ['idle', 'checking', 'up-to-date', 'downloading', 'downloaded', 'error']) {
      await app.evaluate(({ BrowserWindow }, state) => BrowserWindow.getAllWindows()[0].webContents.send('updater:status-changed', {
        state, supported: true, currentVersion: '0.1.2', version: '0.1.3', progress: 45, errorCode: 'network'
      }), state)
      await page.waitForTimeout(100)
      const updateButton = page.locator('.settings-update-actions > button').first()
      assert.equal(await updateButton.isDisabled(), ['checking', 'downloading'].includes(state))
      assert.equal(await updateButton.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(39, 39, 42)')
      await shot('about-' + state)
    }
    await page.getByRole('tab', { name: '同步', exact: true }).click()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('cloud-sync:state-changed', {
      configured: true, enabled: true, hasKey: true, syncing: false, syncedHostCount: 0
    }))
    await page.getByRole('button', { name: '清空云端', exact: true }).click()
    const confirm = page.getByRole('alertdialog')
    await confirm.waitFor()
    assert.equal(await confirm.getByRole('button', { name: '取消', exact: true }).evaluate(el => el === document.activeElement), true)
    await shot('clear-confirmation')
    await page.keyboard.press('Escape')
    assert.equal(await confirm.count(), 0)
    const saved = await page.evaluate(() => window.api.settings.get())
    assert.equal(saved.compactMode, true)
    assert.equal(saved.interfaceAnimations, false)
    assert.equal(saved.showTransferProgress, false)
    assert.equal(saved.downloadDir, userData)
    assert.equal(saved.monitorRefreshInterval, 10)
    assert.deepEqual(errors, [])
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    assert.deepEqual(await page.evaluate(() => window.api.settings.get()), saved)
    console.log('设置还原验收通过；截图目录：' + userData)
  } finally {
    await app.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
