import { useMemo, useState } from 'react'
import { Image, Input, Text, View } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { AppHeader, GenerateDock, UploadSlot } from '@/components'
import {
  BATCH_SIZE,
  MODEL_OPTIONS,
  QUALITY_OPTIONS,
  defaultConfigForRatio,
  optionLabel
} from '@/data/catalog'
import { avatarTemplates } from '@/data/prompt-templates'
import { editImages, generateImages, type ImageAsset } from '@/services/image-api'
import { costForImages } from '@/services/account'
import { setPendingResult } from '@/services/result-store'
import { shortfallOf } from '@/services/api-error'

/**
 * 头像生成
 * ------------------------------------------------------------------
 * 与「产品替换」同一套流程：提示词完全由模板决定（prompt + negative 都已锁定），
 * 页面刻意不提供提示词输入框 —— 这是设计上的约束，不是遗漏。
 *
 * ⚠️ 头像模板有**两种输入形态**（`template.inputMode`，定义见 data/prompt-templates.ts），
 *    本页是同一个页面伺候两种：
 *      · `'photo'`（胶囊眼睛头像）：用户交一张要改编的参考图。
 *        走 `editImages()` —— 参考图先上传换成 fileId 再生成。
 *      · `'text'` （圆钝 IP 形象）：**没有参考图**，用户交一句主体描述。
 *        走 `generateImages()` —— 纯文生图。
 *    ⚠️ 分支判据一律用 `inputMode`，**不要**改成「有没有 asset」：
 *      后者在 mock 模式下错了也不报错（`editImages` 会照常出图、不抛异常），
 *      于是「文生图模板被当成图生图」这种错会一路静默到线上。
 *    ⚠️ 「不提供提示词输入框」这条约束**只对 `'photo'` 成立** ——
 *      `'text'` 模板唯一的输入就是主体描述，不给它输入框等于没输入。
 *      所以下面那个 Input 不是把约束放开了，是另一种形态的等价物。
 *
 * ⚠️ 比例固定为模板里的 '1:1'，**不要让用户选**：两种模板的提示词里都写死了
 *    「在 1:1 的正方形画布上放置一个角色」，换成别的比例等于同时违背提示词和模板语义。
 *    所以这里没有「画面比例」控件，跟自由生图不一样。
 *
 * ⚠️ 布局 2026-09-27 改成与 `create-freeform` **同构**的三层结构
 *    （页头 → input-card + settings-card → GenerateDock），原来那套
 *    `preview-panel + structured-intro + replace-upload-section` 已废。
 *    本页同样**没有可调项**，所以「输出设置」卡是**静态**的（王 2026-09-27 定）。
 */
export default function CreateAvatar() {
  const router = useRouter()
  const template = useMemo(() => {
    const id = router.params?.id
    return avatarTemplates.find((item) => item.id === id) ?? avatarTemplates[0]
  }, [router.params?.id])

  const needsPhoto = template.inputMode === 'photo'

  /**
   * 本页没有任何可调项 ⇒ 请求参数在这里就定死了。
   * 同一份配置既喂「输出设置」卡的摘要、也喂真正的请求，避免两处各算一次。
   */
  const config = useMemo(() => defaultConfigForRatio(template.ratio), [template.ratio])

  const [asset, setAsset] = useState<ImageAsset | undefined>(undefined)
  const [subject, setSubject] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [shortfall, setShortfall] = useState<number | null>(null)

  const handleGenerate = async () => {
    const text = subject.trim()
    // 两种形态各要一样东西，缺了就拦在这里（photo 那条的文案与改动前逐字一致）
    if (needsPhoto && !asset) {
      setError('请先上传要改编的照片')
      return
    }
    if (!needsPhoto && !text) {
      setError('请先填写要生成的 IP 主体')
      return
    }
    setError('')
    setShortfall(null)
    setLoading(true)
    try {
      /**
       * ⚠️ `negative` 现在是**可选**的：`'text'` 模板把排除项写进了 prompt 自己的
       *    「[约束]」一节（外部 skill 的硬要求 —— 现代指令型模型只走一个通道，
       *    不再单独给一份负面提示词）。所以这里必须写成「有才拼」：
       *    写成 `${prompt}\n\n${negative}` 的话，`undefined` 会被拼成
       *    **字面量 "undefined" 四个字母**，而没有任何东西会报错。
       */
      const locked = template.negative ? `${template.prompt}\n\n${template.negative}` : template.prompt
      const base = {
        model: config.model,
        quality: config.quality,
        size: config.size,
        n: BATCH_SIZE,
        // 带上元信息，服务端才会把这次结果写进资产库
        asset: { title: template.name, skill: template.skill, templateId: `avatar-${template.id}` }
      }
      // 「再来一张」快照：请求体抽出来，结果页原样重跑。
      // ⚠️ kind 和 params 必须在同一分支里配对（判别联合），不能先拼 union 再贴 kind。
      const rerun = needsPhoto
        ? { kind: 'edit' as const, params: { ...base, prompt: locked, images: [asset] } }
        : { kind: 'generate' as const, params: { ...base, prompt: `主体：${text}\n\n${locked}` } }
      const images = rerun.kind === 'edit'
        ? await editImages(rerun.params)
        : // 主体单独一行、放在**最前面**：提示词骨架的 [主体] 一节只写「一个 IP 角色」，
          // 具体是什么由这一行给出。放到骨架后面，模型更容易把它当成补充说明而忽略。
          await generateImages(rerun.params)
      setPendingResult({
        templateId: `avatar-${template.id}`,
        title: template.name,
        skill: template.skill,
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
      <AppHeader title='头像生成' />

      {/* 页头 = 96×96 模板缩略图 + 标题。缩略图代替了原来那张 352×383 的大图。 */}
      <View className='composer-page-head is-thumbed'>
        <View className='composer-page-thumb'>
          <Image className='composer-page-thumb-img' src={template.cover} mode='aspectFill' />
        </View>
        <View className='composer-page-heading'>
          <Text className='composer-overline'>
            {needsPhoto ? 'REIMAGINE TEMPLATE' : 'ROUNDED IP TEMPLATE'}
          </Text>
          <Text className='composer-page-title'>
            {needsPhoto ? '上传照片，直接生成。' : '说出主体，直接生成。'}
          </Text>
          <Text className='composer-page-copy'>
            {needsPhoto
              ? '模板会自动保留原图的肤色、发色和识别特征，只重绘成极简 2D 图标。'
              : '一句话说明主体就够了 —— 造型规格由模板锁定：三个颜色、圆钝大形体、从画面左下角涌现。'}
          </Text>
        </View>
      </View>

      <View className='composer-scroll'>
        {/* 第一层：唯一的创作输入。两种形态二选一 */}
        <View className='input-card composer-surface'>
          <View className='composer-section-title'>
            <View>
              <Text>{needsPhoto ? '上传要改编的照片' : '要做什么形象'}</Text>
              <Text className='composer-section-note'>
                {needsPhoto ? '固定绘画规格' : '固定造型规格'} · {template.skill}
              </Text>
            </View>
            <Text>{template.name}</Text>
          </View>

          {needsPhoto ? (
            <>
              <UploadSlot label='上传照片' required icon='▣' asset={asset} onChange={setAsset} />
              <Text className='replace-tip'>
                建议使用正面、清晰、单人的照片；多人合影请先裁剪出要改编的那一位
              </Text>
            </>
          ) : (
            /*
             * 'text' 模板唯一的输入就是主体描述 —— 不给它输入框等于这个模板没有输入。
             * ⚠️ 复用 `create-poster` 那套字段样式（structured-field / field-input），
             *    不另写一套：两份长得一样、只差前缀的样式迟早会漂移，
             *    而**样式表少一条规则不报任何错**（见铁律：className 是字符串）。
             */
            <>
              <View className='structured-field'>
                <Text>IP 主体</Text>
                <Input
                  className='field-input'
                  value={subject}
                  maxlength={40}
                  placeholder='例如：一只圆钝的小猫'
                  placeholderClass='field-placeholder'
                  onInput={(event) => setSubject(event.detail.value)}
                />
              </View>
              <Text className='replace-tip'>
                只填主体；圆钝形体、三个颜色、从左下角涌现都由模板锁定
              </Text>
            </>
          )}

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
