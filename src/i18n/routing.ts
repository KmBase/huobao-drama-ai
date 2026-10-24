import { defineRouting } from 'next-intl/routing'

// The Electron desktop build (scripts/prepare-desktop.js sets
// NEXT_PUBLIC_HUOBAO_DESKTOP=1 at build time) uses localePrefix 'always':
// with 'as-needed', next-intl serves the default locale at '/' via an
// internal middleware rewrite, which currently loops (307 → '/') on the
// standalone server runtime. An explicit redirect has no such problem.
// Unset on normal builds → behavior unchanged for the web app.
export const routing = defineRouting({
  locales: ['zh-CN', 'en'],
  defaultLocale: 'zh-CN',
  localePrefix: process.env.NEXT_PUBLIC_HUOBAO_DESKTOP ? 'always' : 'as-needed',
})

export type Locale = (typeof routing.locales)[number]
