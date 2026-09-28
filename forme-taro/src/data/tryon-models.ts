import thumbModel01 from '@/package-tryon/assets/tryon-models/thumb-model-01.jpg'
import thumbModel02 from '@/package-tryon/assets/tryon-models/thumb-model-02.jpg'
import thumbModel03 from '@/package-tryon/assets/tryon-models/thumb-model-03.jpg'
import thumbModel04 from '@/package-tryon/assets/tryon-models/thumb-model-04.jpg'
import thumbModel05 from '@/package-tryon/assets/tryon-models/thumb-model-05.jpg'
import thumbModel06 from '@/package-tryon/assets/tryon-models/thumb-model-06.jpg'
import thumbModel07 from '@/package-tryon/assets/tryon-models/thumb-model-07.jpg'
import thumbModel08 from '@/package-tryon/assets/tryon-models/thumb-model-08.jpg'

/**
 * 预设模特库（模特试穿用）
 * ==================================================================
 * 8 位模特：4 女 4 男，棚拍 / 街头 / 家居 / 办公室场景混搭。
 * 全身像由 image 2.5 生成（_tryon/gen-models.mjs），半身构图、
 * 身穿纯色打底衣（等着被替换）。
 *
 * 两处存放，用途不同：
 * - 原图 PNG（1024x1536）→ 服务端 `preset-models/` 目录。
 *   前端传 `preset:model-01`，服务端本地直读（见 image.mjs loadInputImages）。
 *   由 deploy/preset-models/ 在服务端部署时带上去，不进 git。
 * - 缩略图 JPG（192x288）→ **打包进小程序**（本文件 import）。
 *   2026-09-28 教训：原来走 pixeltoy.cn/media 远程，文件没传上去时
 *   深色主题下每个卡片都是黑块（--surface-3:#191919），用户看到"全黑屏"。
 *   本地打包零 404 风险，8 张共 57KB，包体积吃得起。
 */
export type TryonPresetModel = {
  /** 与服务端 preset-models/ 下的文件名对应：preset:{id}.png */
  id: string
  /** 选择器里的名字，也是资产库 skill */
  name: string
  /** 选择器里的补充说明 */
  desc: string
  /** 选择器缩略图（本地打包） */
  thumb: string
}

export const TRYON_PRESET_MODELS: TryonPresetModel[] = [
  { id: 'model-01', name: '简约棚拍 · 女', desc: '亚洲年轻女性 · 浅灰影棚', thumb: thumbModel01 },
  { id: 'model-02', name: '街头休闲 · 女', desc: '亚洲年轻女性 · 城市街头', thumb: thumbModel02 },
  { id: 'model-03', name: '欧美棚拍 · 女', desc: '欧美年轻女性 · 米白影棚', thumb: thumbModel03 },
  { id: 'model-04', name: '家居日常 · 女', desc: '亚洲轻熟女性 · 温馨客厅', thumb: thumbModel04 },
  { id: 'model-05', name: '简约棚拍 · 男', desc: '亚洲年轻男性 · 浅灰影棚', thumb: thumbModel05 },
  { id: 'model-06', name: '街头休闲 · 男', desc: '亚洲年轻男性 · 城市街头', thumb: thumbModel06 },
  { id: 'model-07', name: '欧美棚拍 · 男', desc: '欧美年轻男性 · 深灰影棚', thumb: thumbModel07 },
  { id: 'model-08', name: '商务休闲 · 男', desc: '亚洲轻熟男性 · 现代办公室', thumb: thumbModel08 }
]

export function tryonPresetById(id: string): TryonPresetModel | undefined {
  return TRYON_PRESET_MODELS.find((model) => model.id === id)
}
