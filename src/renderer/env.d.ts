/// <reference types="vite/client" />

import type { RendererApi } from '@shared/types'

declare global {
  interface Window {
    /** 预加载桥暴露的白名单 API，类型与 src/shared/types.ts 保持一致 */
    api: RendererApi
  }
}

export {}
