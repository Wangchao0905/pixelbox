import { useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import GenerateDock from './GenerateDock'
import OptionPills from './OptionPills'
import PrivacyGate from './PrivacyGate'
import PromptField from './PromptField'
import SectionHeading from './SectionHeading'
import UploadSlot from './UploadSlot'
import { BATCH_SIZE, RATIO_OPTIONS, defaultConfigForRatio } from '@/data/catalog'
import { costForImages } from '@/services/account'
import { editImages, type ImageAsset } from '@/services/image-api'
import {
  PRODUCT_STUDIO_BLOCKER_HINT,
  PRODUCT_STUDIO_NOTE_MAX,
  buildProductStudioPrompt,
  canGenerateProductStudio,
  intentFromValue,
  intentValue,
  productStudioBlocker,
  productStudioEditImages,
  productStudioIntentFromParam,
  productStudioIntentMeta,
  productStudioOptions,
  productStudioRatio,
  productStudioSkill,
  productStudioTemplateId,
  productStudioTitle,
  type ProductStudioDraft,
  type ProductStudioInput,
  type ProductStudioIntent
} from '@/services/product-studio'
import { setPendingResult } from '@/services/result-store'

/**
 * 产品工作室的创作表单（产品拍摄 / 电商主图**共用同一份**）
 * ==================================================================
 * 两个页面各自只做一件事：渲染 `<AppHeader title='…' />` 再挂上这个组件。
 * 为什么这样切：
 *
 * ① **`<AppHeader>` 必须留在页面文件里。** `scripts/verify-dist.mjs` 的
 *    `HEADER_PAGES` 是在**页面分块**（`dist/pages/<页>/index.js`）里找
 *    `title:"…"` 这个调用点 —— 把顶栏挪进共享组件，那个字符串会落进公共分块，
 *    门禁会红，而页面其实是对的。（同 `--capsule-r` 那条的成因，方向相反。）
 *
 * ② **表单本身必须只有一份。** 两个工作流的差别**全在提示词约束**上，
 *    界面结构完全相同。各写一份的话，加一个模式时必漏改一处 ——
 *    不报错，只是那一页少了这个选项。
 *
 * ③ **这里没有视觉参考图，也没有权利确认。** 产品主体只能是用户上传的
 *    那一张（`productStudioEditImages()` 永远返回 `[product]`）。
 *    不要因为「和灵感复刻长得像」就把它并过去。
 */

type Props = {
  kind: ProductStudioIntent['kind']
  /**
   * 路由参数里带过来的初始模式 / 镜头（产品工作室选完模式跳过来时用）。
   * ⚠️ 可能是非法值（手改链接、旧分享链接）—— 解析走
   *    `productStudioIntentFromParam`，非法时**退回默认而不是抛错**，
   *    否则用户看到的是白屏。
   */
  initialValue?: string
}

export default function ProductStudioComposer({ kind, initialValue }: Props) {
  const meta = productStudioIntentMeta(kind)

  const [draft, setDraft] = useState<ProductStudioDraft>({
    product: null,
    intent: productStudioIntentFromParam(kind, initialValue),
    note: ''
  })
  const [ratio, setRatio] = useState(productStudioRatio(draft.intent))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  /** 只改一个字段，其余原样保留 —— 不要「重新构造整个草稿」，漏一个字段就是静默清空。 */
  const patch = (next: Partial<ProductStudioDraft>) =>
    setDraft((current) => ({ ...current, ...next }))

  /**
   * 换模式 / 镜头时**把比例一起带回该模式的推荐值**。
   * ⚠️ 不能只在初始 useState 里算一次：棚拍推荐 1:1、生活方式推荐 4:5，
   *    换了模式而比例不动的话，用户拿到的构图和刚选的那个模式对不上。
   *    用户之后仍可手动改比例（改完不会再被覆盖，直到下次换模式）。
   */
  const selectOption = (value: string) => {
    const intent = intentFromValue(kind, value)
    setDraft((current) => ({ ...current, intent }))
    setRatio(productStudioRatio(intent))
  }

  // 缺什么、能不能生成，都从服务层拿 —— 页面不自己写判定链（会漂）
  const blocker = productStudioBlocker(draft)
  const ready = blocker === null

  // 收窄成 `{ value: string; … }[]`：两个 kind 的选项是不同字面量类型，
  // 不收敛的话 `.find()` 落在联合类型上，取值处会多出无谓的断言。
  const options: readonly { value: string; label: string; copy: string }[] =
    productStudioOptions(kind)
  const selectedValue = intentValue(draft.intent)
  const selectedCopy = options.find((option) => option.value === selectedValue)?.copy ?? ''

  const notePlaceholder =
    kind === 'product-shot'
      ? '例如：背景换成水泥灰，光线从左侧来'
      : '例如：底色调成低饱和米色，右上角留出文案位置'

  const handleGenerate = async () => {
    // 按钮未就绪时是禁用的，正常走不到这里；留着是为了不依赖 UI 层的正确性
    if (!canGenerateProductStudio(draft)) {
      setError(blocker ? PRODUCT_STUDIO_BLOCKER_HINT[blocker] : '请先添加产品图片')
      return
    }

    setError('')
    setLoading(true)
    try {
      const input: ProductStudioInput = {
        product: draft.product,
        intent: draft.intent,
        note: draft.note.trim()
      }
      const config = defaultConfigForRatio(ratio)

      // 上传、扣费、幂等键、AIGC 标识、资产库写入都在 editImages / GenerateDock /
      // 结果页里，这一页不重复实现任何一条。
      const images = await editImages({
        prompt: buildProductStudioPrompt(input),
        model: config.model,
        quality: config.quality,
        size: config.size,
        n: BATCH_SIZE,
        images: productStudioEditImages(input),
        asset: {
          title: productStudioTitle(input.intent),
          skill: productStudioSkill(input.intent),
          templateId: productStudioTemplateId(input.intent)
        }
      })

      setPendingResult({
        templateId: productStudioTemplateId(input.intent),
        title: productStudioTitle(input.intent),
        skill: productStudioSkill(input.intent),
        images
      })
      Taro.navigateTo({ url: '/pages/result/index' })
    } catch (cause) {
      // 草稿保持不动：用户可以直接再点一次，不用重新选图
      setError(cause instanceof Error ? cause.message : '暂时无法生成，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <View className='composer-page-head'>
        <Text className='composer-overline'>{meta.eyebrow}</Text>
        <Text className='composer-page-title'>{meta.headline}</Text>
        <Text className='composer-page-copy'>{meta.description}</Text>
      </View>

      {/* ---------------- 产品图片（唯一的必填项） ---------------- */}
      <View className='composer-block'>
        <View className='form-heading'>
          <SectionHeading eyebrow='YOUR PRODUCT' title='产品图片' />
        </View>
        <UploadSlot
          label='产品图片'
          required
          icon='▣'
          asset={draft.product ?? undefined}
          hint='正面、清晰、背景干净的产品照'
          removeLabel='移除产品图'
          onChange={(asset: ImageAsset) => patch({ product: asset })}
          onRemove={() => patch({ product: null })}
        />
        <Text className='composer-block-note'>
          这张图是画面里唯一的产品主体，轮廓、包装比例与上面的文字会被保留。
        </Text>
        {blocker === 'product' ? (
          <Text className='composer-blocker'>{PRODUCT_STUDIO_BLOCKER_HINT.product}</Text>
        ) : null}
      </View>

      {/* ---------------- 拍摄方式 / 主图类型 ---------------- */}
      <View className='composer-choice'>
        <Text className='composer-choice-title'>{meta.choiceTitle}</Text>
        <Text className='composer-choice-copy'>{meta.choiceCopy}</Text>
        <OptionPills
          label={meta.choiceLabel}
          value={selectedValue}
          options={options}
          showSelectedMark
          onChange={selectOption}
        />
        {/* 选中项的那句人话说明。空串时不渲染空节点 —— 空 <Text> 会占一行高度。 */}
        {selectedCopy ? <Text className='composer-choice-copy'>{selectedCopy}</Text> : null}
      </View>

      {/* ---------------- 画面比例 ---------------- */}
      <View className='composer-choice'>
        <Text className='composer-choice-title'>画面比例</Text>
        <Text className='composer-choice-copy'>换模式时它会回到该模式的推荐值，也可以在这里改成别的。</Text>
        <OptionPills
          label='画面比例'
          value={ratio}
          options={RATIO_OPTIONS.map((item) => ({ value: item, label: item }))}
          showSelectedMark
          onChange={setRatio}
        />
      </View>

      {/* ---------------- 补充说明 ---------------- */}
      <View className='composer-block'>
        <View className='form-heading'>
          <SectionHeading eyebrow='OPTIONAL' title='补充说明（可选）' />
        </View>
        <PromptField
          value={draft.note}
          maxlength={PRODUCT_STUDIO_NOTE_MAX}
          placeholder={notePlaceholder}
          onChange={(note) => patch({ note })}
        />
      </View>

      <GenerateDock
        metaLabel={meta.title}
        cost={costForImages(BATCH_SIZE)}
        loading={loading}
        disabled={!ready}
        hint={blocker ? PRODUCT_STUDIO_BLOCKER_HINT[blocker] : ''}
        error={error}
        onGenerate={handleGenerate}
      />

      <PrivacyGate />
    </>
  )
}
