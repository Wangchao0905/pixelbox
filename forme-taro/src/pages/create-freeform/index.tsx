import { useState } from 'react'
import { useLoad } from '@tarojs/taro'
import { Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { AppHeader, GenerateDock, OptionPills, PrivacyGate, PromptField } from '@/components'
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
import { costForImages } from '@/services/account'
import { toggleSettings } from '@/services/create-ui'
import { editImages, generateImages, pickImage, type ImageAsset } from '@/services/image-api'
import {
  appendReferenceImage,
  MAX_REFERENCE_IMAGES,
  removeReferenceImage,
  takeReferenceDraft
} from '@/services/reference-images'
import { setPendingResult } from '@/services/result-store'
import { shortfallOf } from '@/services/api-error'

const SUGGESTIONS = [
  { label: '产品广告', value: '一件极简护肤产品置于清晨的湿润石材台面，柔和侧光，商业摄影质感' },
  { label: '电影海报', value: '雨夜东京街头，一家发光的绿色唱片店，电影感，35mm 胶片质感' }
]

export default function CreateFreeform() {
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState<GenerationModel>('gpt-image-2.5-sunburst')
  const [quality, setQuality] = useState<GenerationQuality>('auto')
  const [ratio, setRatio] = useState('1:1')
  const [referenceImages, setReferenceImages] = useState<ImageAsset[]>(() => {
    const draft = takeReferenceDraft()
    return draft ? [draft] : []
  })
  // Keep the two secondary creation tools visible on first entry.  They remain
  // collapsible, but hiding both by default made the redesigned page look like
  // the legacy composer in the mini-program simulator.
  const [settingsExpanded, setSettingsExpanded] = useState(true)
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [shortfall, setShortfall] = useState<number | null>(null)

  useLoad((params) => {
    if (params.prompt) setPrompt(decodeURIComponent(params.prompt))
  })

  const handleAddReference = async () => {
    try {
      const image = await pickImage({ sourceType: ['album'] })
      if (image) setReferenceImages((current) => appendReferenceImage(current, image))
    } catch (cause: any) {
      const message = String(cause?.message ?? cause?.errMsg ?? '')
      if (!message.includes('cancel')) Taro.showToast({ title: message || '选择图片失败', icon: 'none' })
    }
  }

  const handleGenerate = async () => {
    setError('')
    setShortfall(null)
    setLoading(true)
    try {
      const skillLabel = MODEL_OPTIONS.find((item) => item.value === model)?.label ?? 'Image 2.5'
      const request = {
        prompt: prompt || '创作一张高级感、适合社交媒体发布的视觉作品',
        model,
        quality,
        size: defaultConfigForRatio(ratio).size,
        n: BATCH_SIZE,
        asset: { title: '自由生图', skill: skillLabel, templateId: 'freeform' }
      }
      // 「再来一张」快照：有参考图走 edit，没有走 generate，分支内配对 kind
      const rerun = referenceImages.length
        ? { kind: 'edit' as const, params: { ...request, images: referenceImages } }
        : { kind: 'generate' as const, params: request }
      const images = rerun.kind === 'edit' ? await editImages(rerun.params) : await generateImages(rerun.params)
      setPendingResult({
        templateId: 'freeform',
        title: '自由生图',
        skill: skillLabel,
        images,
        rerun
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
      <AppHeader title='自由生图' />
      <View className='composer-page-head'>
        <Text className='composer-overline'>AI IMAGE STUDIO</Text>
        <Text className='composer-page-title'>描述你想看见的画面</Text>
        <Text className='composer-page-copy'>先写下想法。图片、比例和清晰度可在需要时再补充。</Text>
      </View>

      <View className='composer-scroll'>
        <View className='input-card composer-surface'>
          <PromptField className='freeform-prompt' value={prompt} maxlength={500} onChange={setPrompt} placeholder='例如：雨夜东京街头，一家发光的绿色唱片店，电影感，35mm 胶片质感' />

          <View className='composer-reference-section reference-images-inline'>
            <View className='composer-section-title'>
              <View>
                <Text>参考图片</Text>
                <Text className='composer-section-note'>可选，最多 {MAX_REFERENCE_IMAGES} 张</Text>
              </View>
              <Text>{referenceImages.length}/{MAX_REFERENCE_IMAGES}</Text>
            </View>
            <View className='reference-grid'>
              {referenceImages.map((image, index) => (
                <View key={`${image.path}-${index}`} className='reference-thumb'>
                  <Image className='reference-preview' src={image.path} mode='aspectFill' />
                  <View className='reference-remove' hoverClass='press-dim' onClick={() => setReferenceImages((current) => removeReferenceImage(current, index))}>
                    <Text>×</Text>
                  </View>
                </View>
              ))}
              {referenceImages.length < MAX_REFERENCE_IMAGES ? (
                <View className='reference-add-inline' hoverClass='press-dim' onClick={handleAddReference}>
                  <Text className='reference-add-icon'>+</Text>
                  <Text className='reference-add-label'>添加图片</Text>
                </View>
              ) : null}
            </View>
          </View>

          <View
            className='suggestions-toggle'
            hoverClass='press-dim'
            onClick={() => setSuggestionsExpanded((expanded) => !expanded)}
          >
            <Text>💡 创意建议</Text>
            <Text className='toggle-arrow'>{suggestionsExpanded ? '▲' : '▼'}</Text>
          </View>
          {suggestionsExpanded ? (
            <View className='suggestions-inline'>
              {SUGGESTIONS.map((item) => (
                <View key={item.label} className='suggestion-chip' hoverClass='press-dim' onClick={() => setPrompt(item.value)}>
                  <Text>{item.label}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <View className='settings-card'>
          <View
            className='settings-header composer-toolbar'
            hoverClass='press-dim'
            onClick={() => setSettingsExpanded((expanded) => toggleSettings(expanded))}
          >
            <Text>高级设置</Text>
            <View className='settings-badge'>
              <Text>{ratio} · {optionLabel(QUALITY_OPTIONS, quality)} · {optionLabel(MODEL_OPTIONS, model)}</Text>
            </View>
          </View>
          <View className={`composer-settings-panel ${settingsExpanded ? 'is-expanded' : ''}`}>
            <OptionPills label='模型' value={model} options={MODEL_OPTIONS} onChange={(value) => setModel(value as GenerationModel)} />
            <OptionPills label='清晰度' value={quality} options={QUALITY_OPTIONS} onChange={(value) => setQuality(value as GenerationQuality)} />
            <OptionPills label='画面比例' value={ratio} options={RATIO_OPTIONS.map((item) => ({ value: item, label: item }))} onChange={setRatio} />
          </View>
        </View>
      </View>

      <GenerateDock
        metaLabel='自由创作'
        cost={costForImages(BATCH_SIZE)}
        loading={loading}
        error={error}
        shortfall={shortfall}
        onGenerate={handleGenerate}
      />
      <PrivacyGate />
    </View>
  )
}
