import { useState } from 'react'
import { Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import coverInspirationRecreate from '@/assets/cover-inspiration-recreate.jpg'
import {
  AppHeader,
  GenerateDock,
  OptionPills,
  PrivacyGate,
  PromptField,
  UploadSlot
} from '@/components'
import { BATCH_SIZE, RATIO_OPTIONS, defaultConfigForRatio } from '@/data/catalog'
import { costForImages } from '@/services/account'
import { toggleSettings } from '@/services/create-ui'
import { editImages, type ImageAsset } from '@/services/image-api'
import { openPrivacyContract } from '@/services/privacy'
import {
  RECREATE_BLOCKER_HINT,
  RECREATE_FOCUS_OPTIONS,
  RECREATE_NOTE_MAX,
  buildReferenceRecreatePrompt,
  canGenerateReferenceRecreate,
  recreateBlocker,
  recreateEditImages,
  recreateFocusLabel,
  type RecreateFocus,
  type ReferenceRecreateDraft,
  type ReferenceRecreateInput
} from '@/services/reference-recreate'
import { setPendingResult } from '@/services/result-store'
import { shortfallOf } from '@/services/api-error'

/**
 * 灵感复刻
 * ==================================================================
 * 用一张自有产品图 + 一张视觉参考图，生成「以你的产品为主体、借鉴所选
 * 视觉要素」的新图。对应交接文件 `docs/handoffs/2026-09-23-inspiration-recreate.md`。
 *
 * 四个刻意的设计：
 *
 * ① **两张图角色不可混淆。** 两个上传槽用不同标题、不同图标、不同空状态
 *    说明、不同删除文案 —— 差别全部由**文字**承担，不靠颜色。用户在读屏、
 *    低对比度或只看截图时，都必须能分清哪张是产品、哪张是参考。
 *    2026-09-27 起两槽**并排**（`.upload-grid` = `1fr 1fr`）：左右并列本身
 *    就是「这是同一层级的两个输入」的形状。原来上下排时第二个槽的下沿在
 *    801px，而生成条从 719px 起 —— 首屏看不全第二个槽。
 *
 * ② **所有编排逻辑在 `services/reference-recreate.ts`。** 页面里不出现
 *    提示词、数组下标、focus 中文字符串。素材顺序 `[产品, 参考]` 由
 *    `recreateEditImages()` 独占 —— 顺序反了不会报错，只会出图主体不对。
 *
 * ③ **失败不清空草稿。** 上传失败 / 生成失败 / 取消选择，两张图、选项与
 *    补充说明都留着。用户重试的成本应该只是再点一次，不是重新选图。
 *
 * ④ **权利确认（`.recreate-rights`）刻意留在两张卡之外。** 它是一句
 *    法务声明，不是设置项；塞进卡片会被读成「可选项」。它现在是独立一块 +
 *    44px 命中区，**不要**为了「整齐」把它并进 `settings-card`。
 *
 * ------------------------------------------------------------------
 * 布局 2026-09-27 改成与自由生图 / 字段式海报**同构**的三层：
 *
 *   composer-page-head（96×96 封面缩略图 + 标题）
 *     → composer-scroll
 *         input-card      创作输入：素材（两张图）+ 保留什么 + 补充说明
 *         settings-card   可调项：输出设置（画面比例）
 *         recreate-rights 法务声明（不在卡里）
 *     → GenerateDock
 *
 * 为什么页头有缩略图：用首页「灵感复刻」卡的那张封面
 * （`cover-inspiration-recreate.jpg`，640×960 = 2:3）。它**已经被
 * `pages/home/index.tsx` import**，本来就在包里 ⇒ 这一处**不增加任何字节**，
 * 但用户一眼就能认出「这就是我刚才点的那张卡」。
 *
 * 为什么页头没有说明文案：原来那两行（「选一张你有权使用的画面，再上传你的
 * 产品。只借鉴你勾选的那一项，其余重新组织。」）下半句和「保留什么？」的说明
 * 一字不差，上半句由两个槽的 label + hint 说清了。去掉后页头从 162.6px 收到
 * 134px（与字段式海报实测的 133px 一致）。
 *
 * 不做的事（交接文件明确排除）：多张参考图、批量投放、商品网址导入、
 * 抠图/选区/图层，以及任何客户端直连第三方服务的路径。
 */

/** 默认画面比例。用户可在「输出设置」里改。 */
const DEFAULT_RATIO = '2:3'

export default function CreateReference() {
  const [draft, setDraft] = useState<ReferenceRecreateDraft>({
    product: null,
    reference: null,
    focus: 'composition',
    note: '',
    rightsConfirmed: false
  })
  const [ratio, setRatio] = useState(DEFAULT_RATIO)
  /**
   * 与自由生图 / 字段式海报同默认值：**展开**。
   * 折叠起来的话首屏只剩两张空上传槽，看起来像旧版 composer（P0 时踩过）。
   */
  const [settingsExpanded, setSettingsExpanded] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [shortfall, setShortfall] = useState<number | null>(null)

  /**
   * 只改一个字段，其余原样保留。
   * ⚠️ 不要用「重新构造整个草稿」的写法 —— 那样每加一个字段就要改一处，
   *    漏掉一处就是**静默清空**用户已经选好的东西。
   */
  const patch = (next: Partial<ReferenceRecreateDraft>) =>
    setDraft((current) => ({ ...current, ...next }))

  // 缺什么、能不能生成，都从服务层拿 —— 页面不自己写判定链（会漂）
  const blocker = recreateBlocker(draft)
  const ready = blocker === null

  /**
   * 「素材 0/2」的分子。
   * ⚠️ 它与 `blocker` **不是同一个判据**（`blocker` 还看权利确认），
   *    所以不能拿 `blocker` 反推 —— 那会让勾完权利后计数凭空跳到 2/2。
   */
  const filled = (draft.product ? 1 : 0) + (draft.reference ? 1 : 0)

  const handleGenerate = async () => {
    // 按钮在未就绪时是禁用的，正常走不到这里；留着是为了不依赖 UI 层的正确性
    if (!canGenerateReferenceRecreate(draft)) {
      setError(blocker ? RECREATE_BLOCKER_HINT[blocker] : '请先补全两张素材')
      return
    }

    setError('')
    setShortfall(null)
    setLoading(true)
    try {
      const input: ReferenceRecreateInput = {
        product: draft.product,
        reference: draft.reference,
        focus: draft.focus,
        note: draft.note.trim()
      }
      const config = defaultConfigForRatio(ratio)

      // 上传、扣费、幂等键、AIGC 标识、资产库写入都在 editImages / GenerateDock /
      // 结果页里，这一页不重复实现任何一条。
      // 「再来一张」快照：prompt 已编译，素材是当时的两张图（同一会话内有效）
      const request = {
        prompt: buildReferenceRecreatePrompt(input),
        model: config.model,
        quality: config.quality,
        size: config.size,
        n: BATCH_SIZE,
        images: recreateEditImages(input),
        asset: {
          title: '灵感复刻',
          skill: recreateFocusLabel(input.focus),
          templateId: 'reference-recreate'
        }
      }
      const images = await editImages(request)

      setPendingResult({
        templateId: 'reference-recreate',
        title: '灵感复刻',
        skill: recreateFocusLabel(input.focus),
        images,
        rerun: { kind: 'edit', params: request }
      })
      Taro.navigateTo({ url: '/pages/result/index' })
    } catch (cause) {
      // 草稿保持不动：用户可以直接再点一次，不用重新选图
      const need = shortfallOf(cause, costForImages(BATCH_SIZE))
      setShortfall(need)
      setError(need == null ? (cause instanceof Error ? cause.message : '暂时无法生成，请稍后重试') : '')
    } finally {
      setLoading(false)
    }
  }

  const toggleRights = () => patch({ rightsConfirmed: !draft.rightsConfirmed })

  return (
    <View className='app-screen create-content page-pad has-dock page-enter'>
      <AppHeader title='灵感复刻' />

      {/* 页头 = 96×96 封面缩略图 + 标题（文案精简见文件头说明） */}
      <View className='composer-page-head is-thumbed'>
        <View className='composer-page-thumb'>
          <Image className='composer-page-thumb-img' src={coverInspirationRecreate} mode='aspectFill' />
        </View>
        <View className='composer-page-heading'>
          <Text className='composer-overline'>REFERENCE RECREATE</Text>
          <Text className='composer-page-title'>把喜欢的画面，变成你的产品视觉</Text>
        </View>
      </View>

      <View className='composer-scroll'>
        {/* ---------------- 第一层：创作输入 ---------------- */}
        <View className='input-card composer-surface'>
          <View className='composer-section-title'>
            <View>
              <Text>素材</Text>
              <Text className='composer-section-note'>两张图都必需</Text>
            </View>
            <Text>
              {filled}/2
            </Text>
          </View>

          {/* 两个槽并排。差别全靠文字（label / icon / hint / removeLabel），
              并排后仍然逐项不同 —— 门禁 test-creator-ui.mjs 守着这一点。 */}
          <View className='upload-grid'>
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
            <UploadSlot
              label='视觉参考'
              required
              icon='◫'
              asset={draft.reference ?? undefined}
              /* ⚠️ 2026-09-27 从「一张你喜欢的画面，只借它的一部分」（17 字）缩到
                 12 字。两个槽**并排**后每个只有 173px 宽，17 字在 11px 字号下要
                 187px ⇒ 必折两行，第二行只剩「部分」两个字（寡行，截图
                 `_diag/shots/ref-v3-slots-zoom.png` 上一版就是这个问题）。
                 12 字 = 132px，一行放得下。**语义一字未减**：还是「喜欢的画面 +
                 只借一部分」这两件事。
                 这条只改本页 —— 产品工作室没有参考槽，不受影响。 */
              hint='你喜欢的画面，只借一部分'
              removeLabel='换掉参考图'
              onChange={(asset: ImageAsset) => patch({ reference: asset })}
              onRemove={() => patch({ reference: null })}
            />
          </View>

          {/* 两张图原来各有一段说明（分在各自块下）。并排后塞不进半宽 ⇒
              合成一段，**两句话的事实一字未减**，顺序仍对应左=产品、右=参考。

              🪦 这里原来还有一行 `composer-blocker`（「添加产品图片后继续」）。
              2026-09-27 删掉：`GenerateDock` 的 `hint` 用**同一个** `RECREATE_BLOCKER_HINT`
              在生成条上方显示同一句话，而生成条是 `position: fixed` ⇒ **同屏出现两遍**。
              截图证据：`_diag/shots/ref-after-2.png`（y≈455 与 y≈680 各一句）。
              空槽自己带着「必需」小标，字段级提示没有增加信息。
              「为什么不能点」仍由生成条那一句承担 —— 它永远在视野里。 */}
          <Text className='composer-block-note'>
            产品图是画面里唯一的产品主体，包装比例与上面的文字会被保留；参考图里的人物、Logo、文字与商标都不会进入结果。
          </Text>

          {/* 复刻重点：**这一页唯一的创作选择**，不是输出设置 ⇒ 留在创作输入这张卡里，
              保留 17px 标题 + 44px 胶囊的强样式。
              （`.input-card .composer-choice` 只去掉它自己的边框与底色，避免「卡中卡」。） */}
          <View className='composer-choice'>
            <Text className='composer-choice-title'>保留什么？</Text>
            <Text className='composer-choice-copy'>只复刻你选的这一项，画面其余部分重新组织。</Text>
            <OptionPills
              label='复刻重点'
              value={draft.focus}
              options={RECREATE_FOCUS_OPTIONS}
              showSelectedMark
              onChange={(value) => patch({ focus: value as RecreateFocus })}
            />
          </View>

          <View className='composer-section-title'>
            <View>
              <Text>补充说明</Text>
              <Text className='composer-section-note'>可选</Text>
            </View>
          </View>
          <PromptField
            className='reference-note'
            value={draft.note}
            maxlength={RECREATE_NOTE_MAX}
            placeholder='例如：换成清晨的窗边光线，整体更安静一些'
            onChange={(note) => patch({ note })}
          />
        </View>

        {/* ---------------- 第二层：可调项 ----------------
            只有画面比例。模型与清晰度由 `defaultConfigForRatio(ratio)` 定，
            界面不暴露（与产品工作室一致）—— 加它们属于改功能，不是改布局。 */}
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
            {/* OptionPills 只有 label，没有地方放解释 —— 这句不能丢：
                它解释了「为什么改了比例构图会变」。 */}
            <Text className='settings-note'>构图是从参考图借来的，所以比例会影响它是否被裁掉。</Text>
          </View>
        </View>

        {/* ---------------- 权利确认（法务声明，不在任何卡里） ---------------- */}
        <View className='recreate-rights'>
          <View className='recreate-rights-row'>
            {/* 44px 的可点区域包着 22px 的视觉方块：命中区够大，看起来不笨重 */}
            <View className='recreate-rights-hit' hoverClass='press-dim' onClick={toggleRights}>
              <View className={`recreate-rights-box ${draft.rightsConfirmed ? 'is-checked' : ''}`}>
                <Text className='recreate-rights-tick'>{draft.rightsConfirmed ? '✓' : ''}</Text>
              </View>
            </View>
            <Text className='recreate-rights-label' onClick={toggleRights}>
              我拥有或已获准使用这张视觉参考图，并理解结果不会逐像素复制原图，也不会模仿其中的品牌标识。
            </Text>
          </View>
          <View className='recreate-rights-link' hoverClass='press-dim' onClick={openPrivacyContract}>
            <Text>查看《用户隐私保护指引》</Text>
          </View>
        </View>
      </View>

      <GenerateDock
        metaLabel='灵感复刻'
        cost={costForImages(BATCH_SIZE)}
        loading={loading}
        disabled={!ready}
        hint={blocker ? RECREATE_BLOCKER_HINT[blocker] : ''}
        error={error}
        shortfall={shortfall}
        onGenerate={handleGenerate}
      />

      <PrivacyGate />
    </View>
  )
}
