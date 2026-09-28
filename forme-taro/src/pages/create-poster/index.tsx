import { useMemo, useState } from 'react'
import { Image, Input, Text, View } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { AppHeader, GenerateDock, OptionPills, SelectField } from '@/components'
import {
  BATCH_SIZE,
  MODEL_OPTIONS,
  QUALITY_OPTIONS,
  RATIO_OPTIONS,
  defaultConfigForRatio,
  optionLabel,
  type GenerationModel,
  type GenerationQuality
} from '@/data/catalog'
import { compilePrompt, posterDirections } from '@/data/prompt-templates'
import { costForImages } from '@/services/account'
import { toggleSettings } from '@/services/create-ui'
import { generateImages } from '@/services/image-api'
import { setPendingResult } from '@/services/result-store'
import { shortfallOf } from '@/services/api-error'

/**
 * 字段式海报创作页
 * ------------------------------------------------------------------
 * 对应原型 StructuredPosterScreen。
 * 设计要点：只让用户填「主题 + 标题」两项，构图 / 材质 / 排版 / 禁用项
 * 由所选海报方向的 system + negative 提示词锁定，这是这个页面存在的理由。
 *
 * ⚠️ 布局 2026-09-27 改成与 `create-freeform` **同构**的三层结构
 *    （页头 → input-card + settings-card → GenerateDock），原来那套
 *    `preview-panel + structured-intro + structured-section` 已废。
 *    两个动因，都有实测：
 *      · `.preview-panel` 是 `aspect-ratio: 0.92` ⇒ 实测约 **352×383**，
 *        一张图占掉首屏近一半，用户要滚过它才看得到输入项 —— 这是
 *        「界面杂乱」的主因（王 2026-09-27 定：缩成 96×96 并入页头）。
 *      · 原来那套 `structured-*` 是从**浅色主题**时代留下来的，配色是
 *        橄榄绿（`#4a5844` 边框 / `#1a2119` 底 / `#8b9f29` 图标），
 *        和现在近黑近白的语言不是一套。现在全部走令牌。
 */
export default function CreatePoster() {
  const router = useRouter()
  const initialDirectionId = useMemo(() => {
    const id = router.params?.direction
    return posterDirections.some((item) => item.id === id) ? (id as string) : posterDirections[0].id
  }, [router.params?.direction])

  const [directionId, setDirectionId] = useState(initialDirectionId)
  const direction = posterDirections.find((item) => item.id === directionId) ?? posterDirections[0]

  const [theme, setTheme] = useState('')
  const [title, setTitle] = useState('')
  const [ratio, setRatio] = useState(direction.ratio)
  const [model, setModel] = useState<GenerationModel>('gpt-image-2.5-sunburst')
  const [quality, setQuality] = useState<GenerationQuality>('auto')
  /**
   * 这里**没有 `size` 状态** —— 和 `create-freeform` 一样，尺寸只在提交那一刻
   * 由 `defaultConfigForRatio(ratio)` 现算。
   *
   * 原来有一个 `size` state，在三个地方手动同步（初始化 / 换方向 / 换比例）。
   * 三处漏一处，界面显示 4:5 而实际发出 2:3 —— 不报错，只是出图不对。
   * 而且它还额外干了一件事：**把 `1024x1536` 这样的原始像素印给用户看**
   * （「构图与负面提示词已锁定 · 输出 {size}」）。
   *
   * 约定见 `data/catalog.ts`：**比例是给用户选的，尺寸是发给模型的。**
   * 界面只出现比例，像素只在请求体里。
   */

  /**
   * 与 `create-freeform` 同默认值：**展开**。
   * 折叠起来的话首屏只剩输入框，看起来像旧的 composer（P0 时踩过）。
   */
  const [settingsExpanded, setSettingsExpanded] = useState(true)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [shortfall, setShortfall] = useState<number | null>(null)

  const selectDirection = (id: string) => {
    const next = posterDirections.find((item) => item.id === id)
    if (!next) return
    setDirectionId(id)
    setRatio(next.ratio)
    Taro.setNavigationBarTitle({ title: next.name })
  }

  const handleGenerate = async () => {
    setError('')
    setShortfall(null)
    setLoading(true)
    try {
      const prompt = compilePrompt(
        direction.id,
        { THEME: theme || direction.name, TITLE: title || direction.name },
        `画面比例：${ratio}`
      )
      // 「再来一张」快照：prompt 是编译后的完整版，重跑不需要重新填表单
      const request = {
        prompt,
        model,
        quality,
        // 比例 → 尺寸在这里落一次。界面只认比例，像素只出现在请求体里
        size: defaultConfigForRatio(ratio).size,
        n: BATCH_SIZE,
        // 带上元信息，服务端才会把这次结果写进资产库
        asset: { title: direction.name, skill: direction.skill, templateId: `poster-${direction.id}` }
      }
      const images = await generateImages(request)
      setPendingResult({
        templateId: `poster-${direction.id}`,
        title: direction.name,
        skill: direction.skill,
        images,
        rerun: { kind: 'generate', params: request }
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
      <AppHeader title='字段式海报' />

      {/* 页头 = 96×96 模板缩略图 + 标题。缩略图代替了原来那张 352×383 的大图。 */}
      <View className='composer-page-head is-thumbed'>
        <View className='composer-page-thumb'>
          <Image className='composer-page-thumb-img' src={direction.cover} mode='aspectFill' />
        </View>
        <View className='composer-page-heading'>
          <Text className='composer-overline'>EDITABLE POSTER SYSTEM</Text>
          <Text className='composer-page-title'>填入内容，保持风格。</Text>
          <Text className='composer-page-copy'>
            只需填写主题与标题，构图、材质、排版和禁用项会自动保留。
          </Text>
        </View>
      </View>

      <View className='composer-scroll'>
        {/* 第一层：唯一的创作输入。方向 + 两项内容变量 */}
        <View className='input-card composer-surface'>
          <View className='composer-section-title'>
            <View>
              <Text>海报方向</Text>
              <Text className='composer-section-note'>可复用模板 · {direction.skill}</Text>
            </View>
            <Text>{direction.name}</Text>
          </View>
          <SelectField
            value={directionId}
            onChange={selectDirection}
            options={posterDirections.map((item, index) => ({
              value: item.id,
              label: `${String(index + 1).padStart(2, '0')} · ${item.name} — ${item.skill}`
            }))}
          />

          <View className='structured-grid'>
            <View className='structured-field'>
              <Text>主题描述</Text>
              <Input
                className='field-input'
                value={theme}
                maxlength={40}
                placeholder='例如：春日植物展览'
                placeholderClass='field-placeholder'
                onInput={(event) => setTheme(event.detail.value)}
              />
            </View>
            <View className='structured-field'>
              <Text>标题</Text>
              <Input
                className='field-input'
                value={title}
                maxlength={40}
                placeholder='例如：BOTANICAL'
                placeholderClass='field-placeholder'
                onInput={(event) => setTitle(event.detail.value)}
              />
            </View>
          </View>

          {/* 这里原来跟着印了 `· 输出 {size}`（例如「输出 1024x1536」）。
              那是**把原始像素暴露给用户**，和「比例是给用户选的，尺寸是发给模型的」相冲；
              设计稿里这句也只有「已锁定」，没有像素。比例在下面「输出设置」里选。 */}
          <View className='structured-lock'>
            <Text className='lock-icon'>✦</Text>
            <Text>构图与负面提示词已锁定</Text>
          </View>
        </View>

        {/* 第二层：可调项。与自由生图同一套 settings-card */}
        <View className='settings-card'>
          <View
            className='settings-header composer-toolbar'
            hoverClass='press-dim'
            onClick={() => setSettingsExpanded((expanded) => toggleSettings(expanded))}
          >
            <Text>输出设置</Text>
            <View className='settings-badge'>
              <Text>
                {ratio} · {optionLabel(QUALITY_OPTIONS, quality)} · {optionLabel(MODEL_OPTIONS, model)}
              </Text>
            </View>
          </View>
          <View className={`composer-settings-panel ${settingsExpanded ? 'is-expanded' : ''}`}>
            <OptionPills
              label='画面比例'
              value={ratio}
              options={RATIO_OPTIONS.map((item) => ({ value: item, label: item }))}
              onChange={setRatio}
            />
            <OptionPills
              label='模型'
              value={model}
              options={MODEL_OPTIONS}
              onChange={(value) => setModel(value as GenerationModel)}
            />
            <OptionPills
              label='清晰度'
              value={quality}
              options={QUALITY_OPTIONS}
              onChange={(value) => setQuality(value as GenerationQuality)}
            />
          </View>
        </View>

        <View className='back-home-link' hoverClass='press-dim' onClick={() => Taro.navigateBack()}>
          <Text>返回模板库</Text>
        </View>
      </View>

      <GenerateDock
        metaLabel='预计消耗'
        cost={costForImages(BATCH_SIZE)}
        loading={loading}
        error={error}
        shortfall={shortfall}
        onGenerate={handleGenerate}
      />
    </View>
  )
}
