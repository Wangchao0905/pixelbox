import { useState } from 'react'
import { Image, ScrollView, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import {
  AppHeader,
  GenerateDock,
  OptionPills,
  PrivacyGate,
  UploadSlot
} from '@/components'
import { BATCH_SIZE, RATIO_OPTIONS, defaultConfigForRatio } from '@/data/catalog'
import { PORTRAIT_THEMES, defaultThemeOptions, type PortraitTheme } from '../data/portrait-themes'
import { costForImages } from '@/services/account'
import { toggleSettings } from '@/services/create-ui'
import { editImages, type ImageAsset } from '@/services/image-api'
import { setPendingResult } from '@/services/result-store'
import { shortfallOf } from '@/services/api-error'
import {
  PORTRAIT_BLOCKER_HINT,
  canGeneratePortrait,
  portraitBlocker,
  portraitEditImages,
  type PortraitDraft
} from '@/services/portrait'

/**
 * AI 写真（UGC 人像第一刀）
 * ==================================================================
 * 上传 1 张自拍 + 横滑选 1 个主题，一键出主题写真。
 * 链路与模特试穿同构：editImages([自拍], 主题锁定 prompt)。
 *
 * 三个刻意的设计：
 *
 * ① **主题卡是纯文字，没有封面图。** v1 零封面成本、零包体积增长。
 *    批量生成封面前必须先跟王确认数量和成本 —— 在那之前别加 cover。
 *
 * ② **主题即 prompt，页面不许改字。** 提示词在 data/portrait-themes.ts
 *    里锁定（含身份一致性首句），页面只负责把选中的主题 prompt 原样发出。
 *    带可选项的主题（如证件照的服装/领带）由主题自带的 buildPrompt 按选项
 *    拼装 —— 拼装逻辑也在主题定义里，页面同样不碰提示词文字。
 *
 * ③ **失败不清空草稿。** 自拍和主题选择都留着，重试的成本只是再点一次。
 *
 * 布局与模特试穿同构：
 *   composer-page-head（标题，无缩略图 —— 主题没有封面）
 *     → composer-scroll
 *         input-card      创作输入：自拍上传 + 主题选择
 *         settings-card   可调项：输出设置（画面比例）
 *     → GenerateDock
 */

const DEFAULT_RATIO = '2:3'

export default function AiPortrait() {
  const [draft, setDraft] = useState<PortraitDraft>({ photo: null, theme: null })
  const [themeOptions, setThemeOptions] = useState<Record<string, string>>({})
  const [ratio, setRatio] = useState(DEFAULT_RATIO)
  const [settingsExpanded, setSettingsExpanded] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [shortfall, setShortfall] = useState<number | null>(null)

  const patch = (next: Partial<PortraitDraft>) =>
    setDraft((current) => ({ ...current, ...next }))

  const selectTheme = (theme: PortraitTheme | null) => {
    patch({ theme })
    // 换主题时把选项重置为该主题的默认值（无选项的主题 = 空）
    setThemeOptions(theme ? defaultThemeOptions(theme) : {})
  }

  const blocker = portraitBlocker(draft)
  const ready = blocker === null

  const isThemeSelected = (theme: PortraitTheme) => draft.theme?.id === theme.id

  const handleGenerate = async () => {
    if (!canGeneratePortrait(draft)) {
      setError(blocker ? PORTRAIT_BLOCKER_HINT[blocker] : '请先补全素材')
      return
    }

    setError('')
    setShortfall(null)
    setLoading(true)
    try {
      const config = defaultConfigForRatio(ratio)
      const theme = draft.theme
      // 有选项的主题用选项拼提示词，无选项的主题用锁定原文 —— 提示词仍由主题定义，页面不改字
      const prompt = theme.buildPrompt ? theme.buildPrompt(themeOptions) : theme.prompt
      // 四宫格主题强制正方形：格子不变形，选格映射才对得上
      const size = theme.gridPick ? defaultConfigForRatio('1:1').size : config.size
      const request = {
        prompt,
        model: config.model,
        quality: config.quality,
        size,
        n: BATCH_SIZE,
        images: portraitEditImages(draft.photo),
        asset: {
          title: 'AI写真',
          skill: theme.name,
          templateId: `ai-portrait-${theme.id}`
        }
      }
      const images = await editImages(request)

      setPendingResult({
        templateId: `ai-portrait-${theme.id}`,
        title: 'AI写真',
        skill: theme.name,
        images,
        rerun: { kind: 'edit', params: request },
        // 四宫格选格：把主题 id + 当时的选项存下来，结果页凭它重建单张提示词
        gridPick: theme.gridPick
          ? { themeId: theme.id, selections: themeOptions, cells: theme.gridPick.cells }
          : undefined
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
      <AppHeader title='AI写真' />

      <View className='composer-page-head'>
        <View className='composer-page-heading'>
          <Text className='composer-overline'>AI PORTRAIT</Text>
          <Text className='composer-page-title'>上传自拍，一键出主题大片</Text>
        </View>
      </View>

      <View className='composer-scroll'>
        {/* ---------------- 第一层：创作输入 ---------------- */}
        <View className='input-card composer-surface'>
          <View className='composer-section-title'>
            <View>
              <Text>你的自拍</Text>
              <Text className='composer-section-note'>必需</Text>
            </View>
          </View>
          <UploadSlot
            label='自拍照片'
            required
            icon='◍'
            asset={draft.photo ?? undefined}
            hint={draft.theme?.uploadHint ?? '五官清晰的正面照，效果最好'}
            removeLabel='换掉自拍'
            onChange={(asset: ImageAsset) => patch({ photo: asset })}
            onRemove={() => patch({ photo: null })}
          />
          <Text className='composer-block-note'>
            你的脸、发型会原样保留，只换场景、服装和氛围。
          </Text>

          <View className='composer-section-title'>
            <View>
              <Text>选择主题</Text>
              <Text className='composer-section-note'>必需</Text>
            </View>
            {draft.theme && (
              <Text className='tryon-model-clear' onClick={() => selectTheme(null)}>重选</Text>
            )}
          </View>
          <ScrollView className='tryon-model-rail' scrollX showScrollbar={false}>
            {PORTRAIT_THEMES.map((theme) => {
              const selected = isThemeSelected(theme)
              return (
                <View
                  key={theme.id}
                  className={`tryon-model-card ${selected ? 'is-selected' : ''}`}
                  hoverClass='press-dim'
                  onClick={() => selectTheme(theme)}
                >
                  {theme.sample ? (
                    <Image className='tryon-model-thumb' src={theme.sample} mode='aspectFill' />
                  ) : (
                    <View className='tryon-model-thumb is-empty'>
                      <Text className='tryon-model-plus'>◍</Text>
                    </View>
                  )}
                  {selected && (
                    <View className='tryon-model-check'>
                      <Text>✓</Text>
                    </View>
                  )}
                  <Text className='tryon-model-name'>{theme.name}</Text>
                  <Text className='tryon-model-desc'>{theme.desc}</Text>
                </View>
              )
            })}
          </ScrollView>
          <Text className='composer-block-note'>
            每个主题都是一套锁定的拍摄方案，换主题 = 换一套大片。
          </Text>
          {draft.theme?.uploadHint && (
            <Text className='composer-block-note'>◍ {draft.theme.uploadHint}</Text>
          )}
          {/* 主题可选项：只有带 options 的主题（目前仅证件照）才出现 */}
          {draft.theme?.options && draft.theme.options.length > 0 && (
            <View className='composer-theme-options'>
              {draft.theme.options
                // 衬衫不配领带：选衬衫时隐藏领带行
                .filter((opt) => !(opt.key === 'tie' && themeOptions.outfit === 'shirt'))
                .map((opt) => (
                  <OptionPills
                    key={opt.key}
                    label={opt.label}
                    value={themeOptions[opt.key] ?? opt.default}
                    options={opt.choices}
                    showSelectedMark
                    onChange={(value) =>
                      setThemeOptions((current) => ({ ...current, [opt.key]: value }))
                    }
                  />
                ))}
            </View>
          )}
          {/* 四宫格的主题（证件照）：提前告诉用户流程是选格再放大 */}
          {draft.theme?.gridPick && (
            <Text className='composer-block-note'>
              ◍ 一次生成一张四宫格（4 种表情），在结果页选一格，再放大成高清单张。
            </Text>
          )}
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
            <Text className='settings-note'>人像写真默认 2:3 竖构图，最适合手机看。</Text>
          </View>
        </View>
      </View>

      <GenerateDock
        metaLabel='AI写真'
        cost={costForImages(BATCH_SIZE)}
        loading={loading}
        disabled={!ready}
        hint={blocker ? PORTRAIT_BLOCKER_HINT[blocker] : ''}
        error={error}
        shortfall={shortfall}
        onGenerate={handleGenerate}
      />

      <PrivacyGate />
    </View>
  )
}
