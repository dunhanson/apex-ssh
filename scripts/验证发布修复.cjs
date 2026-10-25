const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { _electron: electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

async function main() {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-release-fix-'))
  const host = { id: 'release-local', label: '本地发布验收', host: '127.0.0.1', port: 2222, username: 'apex', auth: { type: 'password', password: 'apex123' } }
  await fs.writeFile(path.join(userData, 'apex-config.json'), JSON.stringify({ hosts: [host], groups: [], recents: [{ ...host, hostId: host.id, connectedAt: Date.now() }] }))
  await fs.writeFile(path.join(userData, 'apex-settings.json'), JSON.stringify({ settings: { language: 'zh-CN', monitorBackgroundEnabled: true, monitorRefreshInterval: 5 } }))
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const executablePath = process.env.APEX_EXECUTABLE || require('electron')
  const args = process.env.APEX_EXECUTABLE ? [] : [path.resolve(__dirname, '..')]
  const app = await electron.launch({ executablePath, args: [...args, '--user-data-dir=' + userData], env })
  try {
    const errors = []
    const page = await app.firstWindow()
    page.on('pageerror', (error) => errors.push(error.message))
    assert.equal(await app.evaluate(() => process.versions.electron), '43.8.3')
    assert.equal(await app.evaluate(({ safeStorage }) => safeStorage.decryptString(safeStorage.encryptString('isolated-release-check'))), 'isolated-release-check')
    // 仅记录调用次数，原有 SSH 执行处理器继续访问真实本地测试服务。
    await app.evaluate(({ ipcMain }) => {
      const handler = ipcMain._invokeHandlers.get('ssh:exec')
      globalThis.releaseExecCounts = {}
      ipcMain.removeHandler('ssh:exec')
      ipcMain.handle('ssh:exec', (event, ...args) => {
        const id = event.sender.id
        globalThis.releaseExecCounts[id] = (globalThis.releaseExecCounts[id] || 0) + 1
        return handler(event, ...args)
      })
    })
    await page.locator('.launcher-host').first().waitFor()
    await page.evaluate(() => { window.releaseSessionId = null; window.api.ssh.onStatus((event) => { if (event.status === 'connected') window.releaseSessionId = event.sessionId }) })
    await page.locator('.launcher-host').first().click()
    await page.waitForFunction(() => window.releaseSessionId)
    const sessionId = await page.evaluate(() => window.releaseSessionId)
    const newWindow = app.waitForEvent('window')
    await page.evaluate((id) => window.api.window.openDetached(id, '发布回归终端快照\r\n'), sessionId)
    const detached = await newWindow
    detached.on('pageerror', (error) => errors.push(error.message))
    await detached.getByTitle('主机监控', { exact: true }).waitFor()
    const contentsId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('detached='))?.webContents.id)
    assert.ok(contentsId)
    // 面板未打开时也应持续采集；等待至少两个五秒周期。
    await detached.waitForTimeout(12000)
    const calls = await app.evaluate((_, id) => globalThis.releaseExecCounts[id] || 0, contentsId)
    assert.ok(calls >= 4, '独立窗口后台采集应持续运行，实际调用：' + calls)
    await detached.getByTitle('主机监控', { exact: true }).click()
    await detached.getByTitle('关闭监控', { exact: true }).waitFor()
    await detached.getByTitle('暂停', { exact: true }).click()
    await detached.getByTitle('继续', { exact: true }).click()
    await detached.getByTitle('SFTP 文件传输', { exact: true }).click()
    await detached.getByRole('button', { name: '隐藏 SFTP 面板', exact: true }).waitFor()
    assert.equal(await detached.getByTitle('关闭监控', { exact: true }).count(), 0)
    await detached.getByTitle('主机监控', { exact: true }).click()
    await detached.getByTitle('关闭监控', { exact: true }).waitFor()
    assert.equal(await detached.getByRole('button', { name: '隐藏 SFTP 面板', exact: true }).count(), 0)
    await detached.getByTitle('关闭监控', { exact: true }).click()
    assert.equal(await detached.evaluate((id) => window.api.ssh.exec(id, 'printf release-ssh-ok').then((result) => result.stdout), sessionId), 'release-ssh-ok')
    await detached.screenshot({ path: path.join(userData, '独立窗口.png') })
    assert.deepEqual(errors, [])
    console.log('Electron 43.8.3、safeStorage、真实 SSH、独立窗口后台采集、监控暂停继续及 SFTP 互斥通过。截图：' + userData)
  } finally { await app.close() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
