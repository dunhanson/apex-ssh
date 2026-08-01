import './i18n'
import { createRoot } from 'react-dom/client'
import App from './App'
import DetachedApp from './DetachedApp'
import './index.css'
import '@xterm/xterm/css/xterm.css'

// 不使用 StrictMode：避免开发期双挂载导致重复发起 SSH 连接
// ?detached=<sessionId> → 独立会话窗口（「移到新窗口」迁出的会话）
const detachedId = new URLSearchParams(location.search).get('detached')

createRoot(document.getElementById('root')!).render(
  detachedId ? <DetachedApp sessionId={detachedId} /> : <App />
)
