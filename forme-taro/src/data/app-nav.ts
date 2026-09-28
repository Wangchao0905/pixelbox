export const APP_NAV_ITEMS = [
  { key: 'create', label: '创作', icon: '✦', path: '/pages/home/index' },
  { key: 'assets', label: '资产', icon: '▣', path: '/pages/assets/index' }
] as const

export type AppNavKey = (typeof APP_NAV_ITEMS)[number]['key']
