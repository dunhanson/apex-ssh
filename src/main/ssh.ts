import { Client, ClientChannel, ConnectConfig } from 'ssh2'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { WebContents } from 'electron'
import type { HostConfig, SessionStatus, TermSize } from '@shared/types'
import { IPC } from '@shared/types'
import { addRecent } from './recents'
import { resolveKeyPath, resolvePassword } from './credentials'

/**
 * ssh2 会话管理器：每个会话一个 ssh2 Client + shell 通道，按 sessionId 隔离，支撑多标签。
 * 所有状态变化（含认证失败、网络错误）都转成 ssh:status 事件发给渲染端，不向 IPC 抛异常。
 * 会话与 webContents 绑定但可 retarget——「移到新窗口」时数据流改发新窗口，通道不断。
 */
interface Session {
  client: Client
  stream: ClientChannel | null
  /** 数据/状态事件的投递目标（迁窗时改绑） */
  wc: WebContents
  host: HostConfig
  directoryProbe: DirectoryProbe | null
}

interface DirectoryProbe {
  marker: Buffer
  output: Buffer[]
  received: Buffer
  timeout: NodeJS.Timeout
  resolve: (path: string) => void
  reject: (error: Error) => void
}

const sessions = new Map<string, Session>()

/** 同一 sessionId 可被重连复用，异步回调只能操作注册时对应的那一代会话。 */
function isCurrentSession(sessionId: string, session: Session): boolean {
  return sessions.get(sessionId) === session
}

function send(wc: WebContents, channel: string, payload: unknown): void {
  if (!wc.isDestroyed()) wc.send(channel, payload)
}

function sendStatus(session: Session, sessionId: string, status: SessionStatus, message?: string): void {
  send(session.wc, IPC.SshStatus, { sessionId, status, message })
}

function cancelDirectoryProbe(session: Session, message: string): void {
  const probe = session.directoryProbe
  if (!probe) return
  session.directoryProbe = null
  clearTimeout(probe.timeout)
  probe.reject(new Error(message))
}

function buildConnectConfig(host: HostConfig, size: TermSize): ConnectConfig {
  const base: ConnectConfig = {
    host: host.host,
    port: host.port,
    username: host.username,
    readyTimeout: 10000,
    // 禁用交互式调试输出，保持默认算法协商
    debug: undefined
  }
  if (host.auth.type === 'password') {
    // 优先解析密码库引用（safeStorage 解密），否则用主机上直接保存的明文
    const password = host.auth.passwordId
      ? resolvePassword(host.auth.passwordId)
      : host.auth.password
    if (!password) throw new Error('密码不可用（凭证库条目缺失或解密失败）')
    return { ...base, password }
  }
  const keyPath = host.auth.keyId ? resolveKeyPath(host.auth.keyId) : host.auth.privateKeyPath
  if (!keyPath) throw new Error('私钥不可用（凭证库条目缺失）')
  return {
    ...base,
    privateKey: readFileSync(keyPath),
    passphrase: host.auth.passphrase || undefined
  }
}

export function connect(wc: WebContents, sessionId: string, host: HostConfig, size: TermSize): void {
  // 同 id 重复连接先清理旧会话（重连复用同一 sessionId）
  disconnect(sessionId)

  const client = new Client()
  const session: Session = { client, stream: null, wc, host, directoryProbe: null }
  sessions.set(sessionId, session)
  sendStatus(session, sessionId, 'connecting')

  client
    .on('ready', () => {
      if (!isCurrentSession(sessionId, session)) {
        client.end()
        return
      }
      client.shell(
        { term: 'xterm-256color', cols: size.cols, rows: size.rows },
        (err, stream) => {
          if (err) {
            if (isCurrentSession(sessionId, session)) {
              sendStatus(session, sessionId, 'error', err.message)
              sessions.delete(sessionId)
            }
            client.end()
            return
          }
          if (!isCurrentSession(sessionId, session)) {
            // 连接建立过程中标签已被关闭，或已由新一代连接替换
            stream.close()
            client.end()
            return
          }
          session.stream = stream
          stream.on('data', (data: Buffer) => {
            if (!isCurrentSession(sessionId, session)) return
            if (session.directoryProbe) {
              consumeDirectoryProbe(session, data)
              return
            }
            send(session.wc, IPC.SshData, { sessionId, data })
          })
          stream.stderr.on('data', (data: Buffer) => {
            if (!isCurrentSession(sessionId, session)) return
            send(session.wc, IPC.SshData, { sessionId, data })
          })
          stream.on('close', () => {
            cancelDirectoryProbe(session, 'SSH 通道已关闭')
            if (isCurrentSession(sessionId, session)) {
              sendStatus(session, sessionId, 'closed')
              sessions.delete(sessionId)
            }
            client.end()
          })
          if (isCurrentSession(sessionId, session)) {
            sendStatus(session, sessionId, 'connected')
            addRecent(host)
          }
        }
      )
    })
    .on('error', (err) => {
      cancelDirectoryProbe(session, err.message)
      if (isCurrentSession(sessionId, session)) {
        sendStatus(session, sessionId, 'error', err.message)
        sessions.delete(sessionId)
      }
    })
    .on('close', () => {
      // 仅在还未通过 stream close 上报过时兜底
      if (isCurrentSession(sessionId, session)) {
        sendStatus(session, sessionId, 'closed')
        sessions.delete(sessionId)
      }
    })

  try {
    client.connect(buildConnectConfig(host, size))
  } catch (err) {
    // 私钥读取失败等同步异常
    if (isCurrentSession(sessionId, session)) {
      sendStatus(session, sessionId, 'error', err instanceof Error ? err.message : String(err))
      sessions.delete(sessionId)
    }
  }
}

export function write(sessionId: string, data: string): void {
  sessions.get(sessionId)?.stream?.write(data)
}

/**
 * 从当前交互式 Shell 查询工作目录。
 * 查询使用 OSC 私有标记，主进程会吞掉命令回显和响应，避免污染终端画面。
 */
export function getCurrentDirectory(sessionId: string): Promise<string> {
  const session = sessions.get(sessionId)
  if (!session?.stream) return Promise.reject(new Error('会话不存在或尚未连接'))
  if (session.directoryProbe) return Promise.reject(new Error('工作目录查询正在进行'))

  const token = randomBytes(12).toString('hex')
  const marker = Buffer.from(`\x1b]777;APEX_PWD_${token};`)

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const probe = session.directoryProbe
      if (!probe || probe.marker !== marker) return
      session.directoryProbe = null
      for (const chunk of probe.output) send(session.wc, IPC.SshData, { sessionId, data: chunk })
      reject(new Error('获取当前工作目录超时'))
    }, 1500)

    session.directoryProbe = {
      marker,
      output: [],
      received: Buffer.alloc(0),
      timeout,
      resolve,
      reject
    }
    session.stream!.write(`printf '\\033]777;APEX_PWD_${token};%s\\007' "$PWD"\r`)
  })
}

function consumeDirectoryProbe(session: Session, data: Buffer): void {
  const probe = session.directoryProbe
  if (!probe) return
  probe.output.push(data)
  probe.received = Buffer.concat([probe.received, data])

  const markerIndex = probe.received.indexOf(probe.marker)
  if (markerIndex < 0) return
  const pathStart = markerIndex + probe.marker.length
  const pathEnd = probe.received.indexOf(0x07, pathStart)
  if (pathEnd < 0) return

  const path = probe.received.subarray(pathStart, pathEnd).toString('utf8')
  clearTimeout(probe.timeout)

  // 留出一个很短的窗口吞掉命令后的换行和新提示符，终端仍保留查询前的提示符。
  setTimeout(() => {
    if (session.directoryProbe !== probe) return
    session.directoryProbe = null
    probe.resolve(path)
  }, 30)
}

/** xterm 的 cols/rows 同步给远端 pty（vim 等全屏程序依赖正确的 stty size） */
export function resize(sessionId: string, cols: number, rows: number): void {
  sessions.get(sessionId)?.stream?.setWindow(rows, cols, 0, 0)
}

export function disconnect(sessionId: string): void {
  const session = sessions.get(sessionId)
  if (!session) return
  sessions.delete(sessionId)
  cancelDirectoryProbe(session, '会话已断开')
  try {
    session.stream?.close()
  } catch {
    /* 通道可能已关闭 */
  }
  session.client.end()
}

/** 应用退出前断开全部会话 */
export function disconnectAll(): void {
  for (const sessionId of [...sessions.keys()]) disconnect(sessionId)
}

/** 断开投递目标已销毁的孤儿会话（窗口关闭后兜底） */
export function disconnectOrphans(): void {
  for (const [sessionId, session] of sessions) {
    if (session.wc.isDestroyed()) disconnect(sessionId)
  }
}

/** 会话是否存在（迁窗前校验） */
export function has(sessionId: string): boolean {
  return sessions.has(sessionId)
}

/** 取会话的主机配置（迁窗时给新窗口恢复会话信息） */
export function getHost(sessionId: string): HostConfig | null {
  return sessions.get(sessionId)?.host ?? null
}

/** 取会话的 ssh2 Client（SFTP 通道复用同一连接） */
export function getClient(sessionId: string): Client | null {
  return sessions.get(sessionId)?.client ?? null
}

/** 把会话的数据/状态事件改投到另一个 webContents（移到新窗口，通道不断） */
export function retarget(sessionId: string, wc: WebContents): void {
  const session = sessions.get(sessionId)
  if (session) session.wc = wc
}
