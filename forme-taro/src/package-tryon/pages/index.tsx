import { useState } from 'react'
import { Image, ScrollView, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import coverModelTryon from '@/assets/cover-model-tryon.jpg'
import {
  AppHeader,
  GenerateDock,
  OptionPills,
  PrivacyGate,
  UploadSlot
} from '@/components'
import { BATCH_SIZE, RATIO_OPTIONS, defaultConfigForRatio } from '@/data/catalog'
import { TRYON_PRESET_MODELS, type TryonPresetModel } from '@/data/tryon-models'
import { costForImages } from '@/services/account'
import { toggleSettings } from '@/services/create-ui'
import { editImages, pickImage, type ImageAsset } from '@/services/image-api'
import { setPendingResult } from '@/services/result-store'
import { shortfallOf } from '@/services/api-error'
import {
  TRYON_BLOCKER_HINT,
  buildTryonPrompt,
  canGenerateTryon,
  tryonBlocker,
  tryonEditImages,
  tryonModelLabel,
  type TryonDraft,
  type TryonModelSelection
} from '@/services/tryon'

/**
 * 模特试穿（Higgsfield 式 Virtual Try-On）
 * ==================================================================
 * 上传一张服装图 + 选一位模特，一键把衣服穿到模特身上。
 *
 * 三个刻意的设计：
 *
 * ① **预设模特是「资源」不是「上传」。** 选预设时不走上传接口，
 *    素材数组里是 `{ fileId: 'preset:model-01', path: '' }`，
 *    `editImages` 直接透传，服务端本地直读。用户自己上传的模特
 *    走正常上传。两种的组装只在 `tryonEditImages()` 里做。
 *
 * ② **模特选择器是横滑条，不是下拉。** 8 位模特的脸和场景是用户
 *    决策的全部依据 —— 必须一眼看全。缩略图走 pixeltoy.cn/media，
 *    与首页封面同一机制，零包体积增长。
 *
 * ③ **失败不清空草稿。** 与灵感复刻同一条规矩：服装图和模特选择
 *    都留着，重试的成本只是再点一次。
 *
 * 布局与灵感复刻同构：
 *   composer-page-head（96×96 封面缩略图 + 标题）
 *     → composer-scroll
 *         input-card      创作输入：服装上传 + 模特选择
 *         settings-card   可调项：输出设置（画面比例）
 *     → GenerateDock
 */

const DEFAULT_RATIO = '2:3'

export default function ModelTryon() {
  const [draft, setDraft] = useState<TryonDraft>({ garment: null, model: null })
  const [ratio, setRatio] = useState(DEFAULT_RATIO)
  const [settingsExpanded, setSettingsExpanded] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [shortfall, setShortfall] = useState<number | null>(null)

  const patch = (next: Partial<TryonDraft>) =>
    setDraft((current) => ({ ...current, ...next }))

  const blocker = tryonBlocker(draft)
  const ready = blocker === null

  const selectPreset = (preset: TryonPresetModel) =>
    patch({ model: { kind: 'preset', preset } })

  const isPresetSelected = (preset: TryonPresetModel) =>
    draft.model?.kind === 'preset' && draft.model.preset.id === preset.id

  const pickCustomModel = async () => {
    const asset = await pickImage({})
    if (asset) patch({ model: { kind: 'custom', asset } })
  }

  const clearModel = () => patch({ model: null })

  const handleGenerate = async () => {
    if (!canGenerateTryon(draft)) {
      setError(blocker ? TRYON_BLOCKER_HINT[blocker] : '请先补全素材')
      return
    }

    setError('')
    setShortfall(null)
    setLoading(true)
    try {
      const config = defaultConfigForRatio(ratio)
      const model: TryonModelSelection = draft.model
      const request = {
        prompt: buildTryonPrompt(),
        model: config.model,
        quality: config.quality,
        size: config.size,
        n: BATCH_SIZE,
        images: tryonEditImages({ garment: draft.garment, model }),
        asset: {
          title: '模特试穿',
          skill: tryonModelLabel(model),
          templateId: 'model-tryon'
        }
      }
      const images = await editImages(request)

      setPendingResult({
        templateId: 'model-tryon',
        title: '模特试穿',
        skill: tryonModelLabel(model),
        images,
        rerun: { kind: 'edit', params: request }
      })
      Taro.navigateTo({ url: '/pages/result/index' })
    } catch (cause) {
      const need = shortfallOf(cause, costForImages(BATCH_SIZE))
      setShortfall(need)
      setError(need == null ? (cause instanceof Error ? cause.message : '暂时无法生成，请稍后重试') : '')
    } finally {
      setLoading(false)
    }
  }

  return (
    <View className='app-screen create-content page-pad has-dock page-enter'>
      <AppHeader title='模特试穿' />

      <View className='composer-page-head is-thumbed'>
        <View className='composer-page-thumb'>
          <Image className='composer-page-thumb-img' src={coverModelTryon} mode='aspectFill' />
        </View>
        <View className='composer-page-heading'>
          <Text className='composer-overline'>MODEL TRY-ON</Text>
          <Text className='composer-page-title'>上传服装，一键穿到模特身上</Text>
        </View>
      </View>

      <View className='composer-scroll'>
        {/* ---------------- 第一层：创作输入 ---------------- */}
        <View className='input-card composer-surface'>
          <View className='composer-section-title'>
            <View>
              <Text>服装图片</Text>
              <Text className='composer-section-note'>必需</Text>
            </View>
          </View>
          <UploadSlot
            label='服装图片'
            required
            icon='▣'
            asset={draft.garment ?? undefined}
            hint='平铺或挂拍的服装照，越清晰越好'
            removeLabel='换掉服装图'
            onChange={(asset: ImageAsset) => patch({ garment: asset })}
            onRemove={() => patch({ garment: null })}
          />
          <Text className='composer-block-note'>
            服装的颜色、印花和版型会被完整保留，只换模特身上的那一件。
          </Text>

          <View className='composer-section-title'>
            <View>
              <Text>选择模特</Text>
              <Text className='composer-section-note'>必需</Text>
            </View>
            {draft.model && (
              <Text className='tryon-model-clear' onClick={clearModel}>重选</Text>
            )}
          </View>
          <ScrollView className='tryon-model-rail' scrollX showScrollbar={false}>
            {TRYON_PRESET_MODELS.map((preset) => {
              const selected = isPresetSelected(preset)
              return (
                <View
                  key={preset.id}
                  className={`tryon-model-card ${selected ? 'is-selected' : ''}`}
                  hoverClass='press-dim'
                  onClick={() => selectPreset(preset)}
                >
                  <Image className='tryon-model-thumb' src={preset.thumb} mode='aspectFill' />
                  {selected && (
                    <View className='tryon-model-check'>
                      <Text>✓</Text>
                    </View>
                  )}
                  <Text className='tryon-model-name'>{preset.name}</Text>
                  <Text className='tryon-model-desc'>{preset.desc}</Text>
                </View>
              )
            })}
            <View
              className={`tryon-model-card is-upload ${draft.model?.kind === 'custom' ? 'is-selected' : ''}`}
              hoverClass='press-dim'
              onClick={pickCustomModel}
            >
              {draft.model?.kind === 'custom' ? (
                <Image
                  className='tryon-model-thumb'
                  src={draft.model.asset.path}
                  mode='aspectFill'
                />
              ) : (
                <View className='tryon-model-thumb is-empty'>
                  <Text className='tryon-model-plus'>＋</Text>
                </View>
              )}
              {draft.model?.kind === 'custom' && (
                <View className='tryon-model-check'>
                  <Text>✓</Text>
                </View>
              )}
              <Text className='tryon-model-name'>上传模特</Text>
              <Text className='tryon-model-desc'>用自己的模特照</Text>
            </View>
          </ScrollView>
          <Text className='composer-block-note'>
            模特的脸、发型、身材和背景原样保留，只换衣服。
          </Text>
        </View>

        {/* ---------------- 第二层：可调项 ---------------- */}
        <View className='settings-card'>
          <View
            className='settings-header composer-toolbar'
            hoverClass='press-dim'
            onClick={() => setSettingsExpanded((expanded) => toggleSettings(expanded))}
          >
            <Text>输出设置</Text>
            <View className='settings-badge'>
              <Text>{ratio}</Text>
            </View>
          </View>
          <View className={`composer-settings-panel ${settingsExpanded ? 'is-expanded' : ''}`}>
            <OptionPills
              label='画面比例'
              value={ratio}
              options={RATIO_OPTIONS.map((item) => ({ value: item, label: item }))}
              showSelectedMark
              onChange={setRatio}
            />
            <Text className='settings-note'>预设模特是 2:3 半身构图，选 2:3 出图最完整。</Text>
          </View>
        </View>
      </View>

      <GenerateDock
        metaLabel='模特试穿'
        cost={costForImages(BATCH_SIZE)}
        loading={loading}
        disabled={!ready}
        hint={blocker ? TRYON_BLOCKER_HINT[blocker] : ''}
        error={error}
        shortfall={shortfall}
        onGenerate={handleGenerate}
      />

      <PrivacyGate />
    </View>
  )
}
