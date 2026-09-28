import { useMemo, useState } from 'react'
import { Image, Text, View } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { AppHeader, GenerateDock, UploadSlot } from '@/components'
import {
  BATCH_SIZE,
  MODEL_OPTIONS,
  QUALITY_OPTIONS,
  defaultConfigForRatio,
  optionLabel
} from '@/data/catalog'
import {
  productReplacementTemplates,
  type ProductPageCopyOverride
} from '@/data/prompt-templates'
import { editImages, type ImageAsset } from '@/services/image-api'
import { costForImages } from '@/services/account'
import { setPendingResult } from '@/services/result-store'
import { shortfallOf } from '@/services/api-error'

/**
 * 产品替换
 * ------------------------------------------------------------------
 * 对应原型 ProductReplaceScreen。
 * 提示词完全由模板决定（prompt + negative 都已锁定），用户唯一能做的是
 * 上传产品图，所以页面刻意不提供提示词输入框——这是设计上的约束，不是遗漏。
 *
 * ⚠️ 布局 2026-09-27 改成与 `create-freeform` **同构**的三层结构
 *    （页头 → input-card + settings-card → GenerateDock），原来那套
 *    `preview-panel + structured-intro + replace-upload-section` 已废。
 *
 * ⚠️ 本页**没有可调项**（比例/模型/清晰度全由模板与默认值定死），
 *    所以「输出设置」卡是**静态**的：只显示锁定摘要，不可点开
 *    （王 2026-09-27 定）。它存在的意义是让三页结构一致，
 *    并且让用户知道这次到底发出去什么。
 */

/**
 * 「产品替换」页的默认正文文案。
 * ------------------------------------------------------------------
 * ⚠️ 这些字面量**就是**改造前页面上的原文，逐字保留 —— 模板表里另外 13 个
 *    产品模板没填 `ProductPageCopyOverride`，所以它们看到的一个字都没变。
 *    改这里 = 同时改那 13 个模板的文案，动手前先想清楚。
 * ⚠️ 「收据拼贴」走的是**另一套**：它的输入是一张照片、输出是「照片 + 热敏
 *    收据」，说「只替换画面中的产品主体」就是错的。那套文案挂在
 *    `prompt-templates.ts` 的条目上，由 `check:prompt-mirror` 守着两边一致。
 * ⚠️ 类型写成 `Required<...>`：少写一条会在 `npm run typecheck` 就报出来，
 *    而不是等到运行时把 `undefined` 渲染进页面（那种失败是**静默**的）。
 */
const DEFAULT_COPY: Required<ProductPageCopyOverride> = {
  pageHeadline: '上传产品，',
  pageHeadlineAccent: '直接生成。',
  pageCopy: '模板会自动保留场景、光线和构图，只替换画面中的产品主体。',
  uploadEyebrow: 'YOUR PRODUCT',
  uploadTitle: '上传你的产品',
  uploadLabel: '上传产品',
  uploadHint: '建议使用正面、清晰、背景干净的产品图',
  uploadError: '请先上传产品图片'
}

export default function CreateProduct() {
  const router = useRouter()
  const template = useMemo(() => {
    const id = router.params?.id
    return productReplacementTemplates.find((item) => item.id === id) ?? productReplacementTemplates[0]
  }, [router.params?.id])

  /**
   * 页面文案：模板填了就按模板，没填就按默认。
   * 逐字段显式取，不用 `{ ...DEFAULT_COPY, ...template }` —— 后者在有人
   * 手写 `pageCopy: undefined` 时会**静默**把文案抹成 `undefined`。
   */
  const copy = useMemo<Required<ProductPageCopyOverride>>(
    () => ({
      pageHeadline: template.pageHeadline ?? DEFAULT_COPY.pageHeadline,
      pageHeadlineAccent: template.pageHeadlineAccent ?? DEFAULT_COPY.pageHeadlineAccent,
      pageCopy: template.pageCopy ?? DEFAULT_COPY.pageCopy,
      uploadEyebrow: template.uploadEyebrow ?? DEFAULT_COPY.uploadEyebrow,
      uploadTitle: template.uploadTitle ?? DEFAULT_COPY.uploadTitle,
      uploadLabel: template.uploadLabel ?? DEFAULT_COPY.uploadLabel,
      uploadHint: template.uploadHint ?? DEFAULT_COPY.uploadHint,
      uploadError: template.uploadError ?? DEFAULT_COPY.uploadError
    }),
    [template]
  )

  /**
   * 本页没有任何可调项 ⇒ 请求参数在这里就定死了。
   * 用同一份配置喂给「输出设置」卡的摘要和真正的请求，避免两处各算一次
   * （那种「界面写 A、发出去 B」的错不报错，只是出图不对）。
   */
  const config = useMemo(() => defaultConfigForRatio(template.ratio), [template.ratio])

  const [asset, setAsset] = useState<ImageAsset | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [shortfall, setShortfall] = useState<number | null>(null)

  const handleGenerate = async () => {
    if (!asset) {
      setError(copy.uploadError)
      return
    }
    setError('')
    setShortfall(null)
    setLoading(true)
    try {
      // 「再来一张」快照：edit 形态，素材是用户刚上传的产品图
      const request = {
        prompt: `${template.prompt}\n\n${template.negative}`,
        images: [asset],
        model: config.model,
        quality: config.quality,
        size: config.size,
        n: BATCH_SIZE,
        // 一键抠图：把 background=transparent 透传给服务端 → 上游，拿真 alpha 通道
        ...(template.background ? { background: template.background } : {}),
        // 带上元信息，服务端才会把这次结果写进资产库
        asset: { title: template.name, skill: template.skill, templateId: `product-${template.id}` }
      }
      const images = await editImages(request)
      setPendingResult({
        templateId: `product-${template.id}`,
        title: template.name,
        skill: template.skill,
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
      <AppHeader title='产品替换' />

      {/* 页头 = 96×96 模板缩略图 + 标题。缩略图代替了原来那张 352×383 的大图。 */}
      <View className='composer-page-head is-thumbed'>
        <View className='composer-page-thumb'>
          <Image className='composer-page-thumb-img' src={template.cover} mode='aspectFill' />
        </View>
        <View className='composer-page-heading'>
          <Text className='composer-overline'>{copy.uploadEyebrow}</Text>
          <Text className='composer-page-title'>
            {copy.pageHeadline}
            {copy.pageHeadlineAccent}
          </Text>
          <Text className='composer-page-copy'>{copy.pageCopy}</Text>
        </View>
      </View>

      <View className='composer-scroll'>
        {/* 第一层：唯一的创作输入 —— 产品图 */}
        <View className='input-card composer-surface'>
          <View className='composer-section-title'>
            <View>
              <Text>{copy.uploadTitle}</Text>
              <Text className='composer-section-note'>固定艺术指导 · {template.skill}</Text>
            </View>
            <Text>{template.name}</Text>
          </View>
          <UploadSlot
            label={copy.uploadLabel}
            required
            icon='▣'
            asset={asset}
            onChange={setAsset}
          />
          <Text className='replace-tip'>{copy.uploadHint}</Text>

          <View className='replace-template-meta'>
            <View>
              <Text className='eyebrow'>TEMPLATE SYSTEM</Text>
              <Text className='replace-name'>{template.name}</Text>
            </View>
            <View className='replace-lock'>
              <Text className='lock-icon'>✦</Text>
              <Text>提示词已锁定</Text>
            </View>
          </View>
        </View>

        {/* 第二层：**静态**设置卡（本页无可调项，不可点开） */}
        <View className='settings-card'>
          <View className='settings-header'>
            <Text>输出设置</Text>
            <View className='settings-badge'>
              <Text>
                {template.ratio} · {optionLabel(QUALITY_OPTIONS, config.quality)} ·{' '}
                {optionLabel(MODEL_OPTIONS, config.model)}
              </Text>
            </View>
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
