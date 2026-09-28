import type { CSSProperties } from 'react'
import { useDidShow } from '@tarojs/taro'
import { useRef, useState } from 'react'
import { Image, Swiper, SwiperItem, Text, Textarea, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import coverInspirationRecreate from '@/assets/cover-inspiration-recreate.jpg'
import coverModelTryon from '@/assets/cover-model-tryon.jpg'
import { PrivacyGate } from '@/components'
import { avatarTemplates, posterDirections, productReplacementTemplates } from '@/data/prompt-templates'
import { getAccountBalance, costForImages } from '@/services/account'
import { BATCH_SIZE } from '@/data/catalog'
import { pickImage, type ImageAsset } from '@/services/image-api'
import { setReferenceDraft } from '@/services/reference-images'
import { capsuleInsetRight, statusBarHeight } from '@/services/system'

/**
 * 首页
 * ==================================================================
 * 设计参照：savee（深色画布 / 图片铺到屏幕边 / 大字压在图上）+ denim 的
 * 「找 → 选 → 做」三段式。**首页负责「找」**：一屏图，左右甩，点进去就是「做」。
 *
 * 相比上一版的变化：
 *  · 点数药丸**移出首页**，改到「我的」（入口 = 右上角头像）
 *  · 原「从灵感开始」横滑轨道删掉，位置由卡片循环取代
 *  · 不再用 .page-pad —— savee 的语言是图铺到边，首页自己让出状态栏与悬浮导航
 *
 * ⚠️ 两个载体不要混：这是 forme-taro（小程序），
 *    work/visual-studio 是浏览器里的设计真源，改那边不会出现在开发者工具里。
 */

type Card = {
  id: string
  name: string
  skill: string
  cover: string
  /** 点这张卡去哪里（三段式里的「做」） */
  url: string
}

/**
 * 卡片循环的素材。
 * ------------------------------------------------------------------
 * ⚠️ 只取**打包进小程序的本地封面**（cover 不是 http 开头的那批）。
 *    远程封面（unsplash / 自有 CDN）在开发者工具里靠 urlCheck:false 能显示，
 *    但真机没有配 downloadFile 白名单时会**整片空白** —— 这正是 memory 里
 *    「封面未钉在自有域名、不在白名单」那条待办。
 *
 * 🔴 路由参数**不是同一个名字**，别照抄：
 *    create-product / create-avatar 读 `?id=`，
 *    而 create-poster 读的是 **`?direction=`**（见 create-poster/index.tsx 第 29 行）。
 *    海报卡片写成 `?id=` **不报任何错** —— 它会静默打开 `posterDirections[0]`。
 *    这条已加产物级门禁（check-poster-directions.mjs 末尾）。
 *    而 create-reference **一个参数都不读** ⇒ 那张卡片的 url 不带任何 query。
 */

/**
 * 🔴 只有这里列出的海报方向才会上首页轮播 —— **显式白名单**（2026-09-26 王要求）。
 * ------------------------------------------------------------------
 * 王的原话：「首页轮播图中有一个手机直出的模板，我没有要求设计这个模板」
 *
 * 查证结果：轮播 18 张里只有「灵感复刻」「食感成字」两张是他要求过的；
 * 另外 **5 张**（纸域微景 / 浅景分离 / 俯拍平铺 / 手机直出 / 异变主体）
 * 在交接文档、记忆、代码注释里**都查不到任何要求记录**。
 *
 * 🔴 根因不是「谁偷偷加了模板」，而是**原来的写法本身就不该存在**：
 *    2026-09-25 起 `posterCards` 是 `posterDirections.map(...)` **全量并入**，
 *    再靠 `CARDS` 末尾的 `.filter(card => !/^https?:/.test(card.cover))` 收口。
 *    那条 filter 的**本意**是「远程封面别进轮播」，**实际效果**却是
 *    「**封面是本地图的海报方向才进轮播**」——
 *    16 个方向里恰好 6 个用本地图（脚本确定性渲染的那批）⇒ 这 6 个自动上了首页。
 *    ⇒ **首页展示什么，被「封面图存在哪儿」这个打包细节决定了，不是设计决定。**
 *       换一张封面的来源（本地 ↔ 远程）会**静默改变首页内容**，而且不报错。
 *
 * ⇒ 改成**显式白名单**：想上首页必须在这里被点名。
 *    **新增海报方向不会再自己冒到首页上** —— 这就是本条存在的全部理由，
 *    ⚠️ 别改回 `posterDirections.map(...)`。
 *    `test:creator-ui`（源码级）与 `verify-dist`（产物级）各有判据钉着。
 *
 * ⚠️ 白名单里的 id 必须是**真方向**：写错的话那张卡会被静默丢掉（不报错）。
 *    `check-poster-directions.mjs` 会读这个数组并逐个比对 `POSTER_IDS`。
 *
 * 当前白名单只有 `food-type`（「食感成字」，王 2026-09-25 要求置顶的那张）。
 */
const CAROUSEL_POSTER_IDS = ['food-type']

const posterCards: Card[] = posterDirections
  .filter((t) => CAROUSEL_POSTER_IDS.includes(t.id))
  .map((t) => ({
    id: t.id,
    name: t.name,
    skill: t.skill,
    cover: t.cover,
    url: `/pages/create-poster/index?direction=${t.id}`
  }))

/**
 * 首页轮播的前两张，**数组顺序就是显示顺序**（2026-09-25 王确认）：
 *   ① 灵感复刻  ② 食感成字
 *
 * ⚠️ 「灵感复刻」不是海报方向，是独立页面（`create-reference`），
 *    所以它没法从 `posterDirections` 里取，只能在这里单独构造一张卡。
 *
 * ⚠️ 封面用 `cover-inspiration-recreate.jpg`（640x960 = 2:3），
 *    **不是** `feature-inspiration-recreate.jpg`（530x662 = 4:5）。
 *    轮播卡 `.hd-card` 是 236x354（2:3），<Image> 又是 aspectFill ⇒
 *    比例不匹配时**不报错、只裁掉**；4:5 那张会被左右各裁 8.36%，
 *    正好切掉「参考照片」的左边缘（它横向从 0.5% 就开始），
 *    而那个矩形边界是「借一张参考图重做」这个概念**唯一的视觉锚点**。
 *    2:3 那张是左对齐裁出来的，边界完整。生成脚本：`_tools/make-cover-inspiration.py`。
 *    这条已加产物级门禁（verify-dist.mjs「首页轮播封面」一节）。
 */
const REFERENCE_CARD: Card = {
  id: 'inspiration-recreate',
  name: '灵感复刻',
  skill: 'INSPIRATION RECREATE',
  cover: coverInspirationRecreate,
  /* 不带 query：create-reference 不读任何路由参数。
     带上不会报错，只会被静默忽略 —— 但下次照抄就抄成 `?id=` 了。 */
  url: '/pages/create-reference/index'
}

/**
 * 「模特试穿」置顶卡（2026-09-28 新增）。
 * 与灵感复刻一样是独立页面（`pages/tryon`），不带 query。
 * 封面 `cover-model-tryon.jpg`（640x960 = 2:3）是真实链路实测产物
 * （上传服装图 → 试穿），封面即功能演示 —— 与一键抠图封面同一条规矩。
 */
const TRYON_CARD: Card = {
  id: 'model-tryon',
  name: '模特试穿',
  skill: 'MODEL TRY-ON',
  cover: coverModelTryon,
  url: '/package-tryon/pages/index'
}

/**
 * 海报方向里置顶的那一个（排在灵感复刻之后）。
 * ⚠️ 只在这里置顶，**不动 `posterDirections` 数组的顺序** —— 那个顺序直接决定
 *    create-poster 页下拉框里的编号，门禁 `check-poster-directions.mjs` 会逐项比对。
 */
const POSTER_PIN_ID = 'food-type'

const LEAD_CARDS: Card[] = [
  REFERENCE_CARD,
  TRYON_CARD,
  ...posterCards.filter((card) => card.id === POSTER_PIN_ID)
]

const CARDS: Card[] = [
  ...LEAD_CARDS,
  /* 按 id 去重，不按位置 —— 改 POSTER_PIN_ID 时不会漏掉一张重复卡。 */
  ...posterCards.filter((card) => !LEAD_CARDS.some((lead) => lead.id === card.id)),
  ...productReplacementTemplates.map((t) => ({
    id: t.id,
    name: t.name,
    skill: t.skill,
    cover: t.cover,
    url: `/pages/create-product/index?id=${t.id}`
  })),
  ...avatarTemplates.map((t) => ({
    id: t.id,
    name: t.name,
    skill: t.skill,
    cover: t.cover,
    url: `/pages/create-avatar/index?id=${t.id}`
  }))
].filter((card) => !/^https?:/.test(card.cover))

const QUICK_ACTIONS = [
  { label: '自由生图', hint: '一句描述开始', path: '/pages/create-freeform/index', mark: '✦' },
  { label: '灵感复刻', hint: '借参考图的一部分', path: '/pages/create-reference/index', mark: '⧉' },
  { label: 'AI写真', hint: '上传自拍出大片', path: '/package-portrait/pages/index', mark: '◍' },
  { label: '模特试穿', hint: '服装一键上身', path: '/package-tryon/pages/index', mark: '◈' },
  { label: '海报', hint: '选一个构图', path: '/pages/create-poster/index', mark: '▤' },
  { label: '产品图', hint: '上传产品照片', path: '/pages/product-gallery/index', mark: '◒' },
  { label: '头像', hint: '制作头像图标', path: '/pages/avatar-gallery/index', mark: '◉' }
]

/**
 * 🪦 这里原来有一块「新功能」集中展示（`FEATURES` + `.home-feature-rail` 三张卡：
 * 灵感复刻 / 产品拍摄 / 电商主图），2026-09-25 王要求**整块删掉**。
 *
 * ⚠️ 它同时**反转了 2026-09-23 的一条规矩**。那条原文是
 *    「所有新加入的功能都应该放在首页的集中展示里，不是单独成为一个模块」——
 *    现在作废了，别再照着它把这块加回来。王 2026-09-25 的原话：
 *    「删除页面下方的新功能三个模板，只把灵感复刻放在首页最上方里」。
 *
 * 现在的首页结构：轮播（灵感复刻打头）→ 快速创作 → 「选择方式」九宫格。
 * 「选择方式」里已经有灵感复刻、海报、产品图、头像各一格，
 * 所以删掉那块**没有孤立任何入口**。
 *
 * ⚠️ 产品拍摄 / 电商主图 从「首页一跳」退成「选择方式 → 产品图 → 切 tab」两跳
 *    （`product-gallery` 把两个意图都做成了 tab，读的是 `PRODUCT_STUDIO_INTENTS`）。
 *    这是王确认过的，不是漏配。
 *
 * ⚠️ 那三张 `feature-*.jpg`（530x662 = 4:5）留在 `src/assets/` 里但**已无人 import**。
 *    小程序只打包被 import 的静态资源 ⇒ 它们**不进包、不占主包体积**。
 *    之所以没删文件：它们是那三套 4:5 构图唯一的存档。
 *    灵感复刻换成了 2:3 的 `cover-inspiration-recreate.jpg`（见上面 REFERENCE_CARD）。
 */

export default function Home() {
  const [active, setActive] = useState(0)
  const [quickPrompt, setQuickPrompt] = useState('')
  /**
   * 首页入口的单次消耗 —— 跟 dock 里是同一个口径（`costForImages` 读服务端
   * 下发的 imageCost，不是写死）。让用户在动手前就知道这一下几毛钱，
   * 价格透明前置，也是点数价值感教育的第一课。
   */
  const genCost = costForImages(BATCH_SIZE)
  /**
   * 「快速创作」里选中的参考图（0 或 1 张）。
   * ------------------------------------------------------------------
   * ⚠️ 它**不在这里参与生成** —— 生成在「自由生图」页做。跳转前用
   *    `setReferenceDraft()` 交给那一页，那边 `takeReferenceDraft()` 接住，
   *    当作参考图（`editImages` 的「图一」）。和「从生成结果再创作」
   *    （`pages/result/index.tsx`）走的是**同一条通路**。
   * ⚠️ `setReferenceDraft` 是**一次性交接**：`takeReferenceDraft()` 取完就置空。
   *    所以用户从自由生图返回首页时，本地的 `reference` 还在（缩略图照显示），
   *    但 draft 已经空了 —— 这是**对的**：再点一次「生成」不该把同一张图
   *    又偷偷塞进去一次。要重发就重新选。
   */
  const [reference, setReference] = useState<ImageAsset | undefined>(undefined)
  /**
   * 分享归因的迎接横幅只展示一次。useDidShow 每次回首页都会触发，
   * 不加这个 guard 的话用户从创作页返回首页时会再弹一次。
   * （2026-09-27 前是 toast，改成横幅：toast 3 秒就没，横幅带行动点）
   */
  const shareBannerShown = useRef(false)
  const [shareBannerVisible, setShareBannerVisible] = useState(false)

  // 首页不再显示点数，但仍然预热一次余额缓存，
  // 这样从首页头像进「我的」时不会先闪一下空值。
  useDidShow(() => {
    const from = Taro.getCurrentInstance().router?.params?.from
    if (from === 'share' && !shareBannerShown.current) {
      shareBannerShown.current = true
      setShareBannerVisible(true)
    }
    getAccountBalance().catch(() => undefined)
  })

  const total = CARDS.length

  /**
   * 到当前卡的最短环形距离（circular 打开时索引会绕回来，
   * 直接相减会把「最后一张」算成距离 n-1，闪避方向就反了）。
   */
  const shortestDelta = (index: number) => {
    const raw = (index - active + total) % total
    return raw > total / 2 ? raw - total : raw
  }

  const openComposer = () => {
    // 先把参考图交给下游页（一次性交接，见 `reference` 的注释）
    if (reference) setReferenceDraft(reference)
    const query = quickPrompt.trim() ? `?prompt=${encodeURIComponent(quickPrompt.trim())}` : ''
    Taro.navigateTo({ url: `/pages/create-freeform/index${query}` })
  }

  const handlePickReference = async () => {
    try {
      // 与「自由生图」页的参考图入口保持一致：只从相册选。
      // 参考图通常是已经存在的图，不是现拍；两处行为不一致会让用户困惑。
      const image = await pickImage({ sourceType: ['album'] })
      if (image) setReference(image)
    } catch (error: any) {
      const message = String(error?.message ?? error?.errMsg ?? '')
      // 用户主动取消不是错误，不要弹提示
      if (message.includes('cancel')) return
      Taro.showToast({ title: message || '选择图片失败', icon: 'none' })
    }
  }

  /**
   * ⚠️ 必须阻止冒泡。外面那层 `.composer-ref-thumb` 带着 onClick（重新选图），
   *    不拦的话点「×」会紧接着弹出系统相册 —— 用户看到的是「删不掉，
   *    反而又让我选图」。而且它**不报错**，只有真的点一下才会发现。
   *    （同 `components/UploadSlot.tsx` 的 `handleRemove`）
   */
  const handleRemoveReference = (event: any) => {
    event?.stopPropagation?.()
    setReference(undefined)
  }

  const openCard = (card: Card) => Taro.navigateTo({ url: card.url })

  /** 分享落地横幅的行动点：直接进自由生图，让新用户先做出第一张 */
  const goShareCreate = () => Taro.navigateTo({ url: '/pages/create-freeform/index' })

  return (
    <View
      className='app-screen home-dark page-enter'
      style={
        {
          '--safe-t': `${statusBarHeight()}px`,
          /* 顶栏右侧让出微信胶囊。custom 导航只是不画原生导航栏，胶囊照样在 ——
             不让位的话「我的」的头像会被胶囊压住（2026-09-22 截图实测）。 */
          '--capsule-r': `${capsuleInsetRight()}px`
        } as CSSProperties
      }
    >
      <View className='hd-topline'>
        <Text className='hd-brand'>Pixel Box</Text>
        <View
          className='hd-avatar'
          hoverClass='press-dim'
          onClick={() => Taro.navigateTo({ url: '/pages/profile/index' })}
        >
          <Text>◉</Text>
        </View>
      </View>

      {shareBannerVisible ? (
        <View className='share-banner'>
          <Text className='share-banner-text'>朋友分享了一张 AI 作品，你也来做一张</Text>
          <Text className='share-banner-cta' onClick={goShareCreate}>
            去生成 →
          </Text>
          <Text
            className='share-banner-close'
            onClick={() => setShareBannerVisible(false)}
          >
            ×
          </Text>
        </View>
      ) : null}

      <View className='hd-stage'>
        <Swiper
          className='hd-swiper'
          circular
          /* margin 用 rpx：原生单位，不会被 Taro 的 pxtransform 二次换算。
             750 - 450 = 300，两侧各 150rpx ⇒ 卡片占屏宽 60%，两侧各露 20%。 */
          previousMargin='150rpx'
          nextMargin='150rpx'
          current={active}
          duration={280}
          onChange={(event) => setActive(event.detail.current)}
        >
          {CARDS.map((card, index) => {
            const delta = shortestDelta(index)
            const isActive = index === active
            // 「两侧的图片轻微的闪避」：相邻卡缩小并往远离中心的方向挪一点
            const dodge = Math.abs(delta) === 1 ? Math.sign(delta) * 7 : 0
            return (
              <SwiperItem key={card.id}>
                <View
                  className='hd-card'
                  hoverClass='is-hovered press-dim'
                  onClick={() => openCard(card)}
                >
                  <View
                    className='hd-card-content'
                    style={{ transform: `translateX(${dodge}px) scale(${isActive ? 1 : 0.9})` }}
                  >
                    <Image className='hd-card-image' src={card.cover} mode='aspectFill' lazyLoad />
                    {isActive ? (
                      <>
                        <View className='hd-card-veil' />
                        <Text className='hd-card-name'>{card.name}</Text>
                      </>
                    ) : null}
                  </View>
                </View>
              </SwiperItem>
            )
          })}
        </Swiper>

        <View className='hd-caption'>
          <Text className='hd-skill'>{CARDS[active]?.skill ?? ''}</Text>
        </View>

        {/* 细进度条取代圆点（2026-09-27 模拟器实测后改）。
            原来是一张卡一个 5px 圆点：白名单落地后轮播 13 张 ⇒ 13 个点、
            整行约 137px，当前项只靠颜色区分，**在 13 个 4px 点里根本看不出来**。
            进度条把「第几张」变成连续量，一张卡也读得出位置。 */}
        <View className='hd-progress'>
          <View
            className='hd-progress-fill'
            style={{ width: `${((active + 1) / CARDS.length) * 100}%` }}
          />
        </View>
      </View>

      <View className='home-intro'>
        <Text className='home-kicker'>AI 视觉创作</Text>
        <Text className='home-title'>从一个想法开始</Text>
        <Text className='home-subtitle'>描述画面，或从上面挑一个方向直接做。</Text>
      </View>

      <View className='home-composer-card'>
        <View className='composer-card-head'>
          <Text className='composer-card-label'>立即开始</Text>
        </View>
        <Textarea
          className='home-composer-input'
          value={quickPrompt}
          maxlength={500}
          autoHeight
          placeholder='例如：给新产品做一张有晨雾感的广告图'
          placeholderClass='prompt-placeholder'
          onInput={(event) => setQuickPrompt(event.detail.value)}
        />
        <View className='composer-card-footer'>
          {reference ? (
            /* 已选：显示缩略图 + 右上角 ×。整块可点 = 换一张（和 UploadSlot 同语义） */
            <View
              className='composer-ref-thumb'
              hoverClass='press-dim'
              onClick={handlePickReference}
            >
              <Image className='composer-ref-image' src={reference.path} mode='aspectFill' />
              <View
                className='composer-ref-remove'
                hoverClass='press-dim'
                onClick={handleRemoveReference}
              >
                <Text>×</Text>
              </View>
            </View>
          ) : (
            /* 未选：+ 号。文案是「参考图」而不是「上传图片」—— 说清它是干什么的 */
            <View className='composer-ref-add' hoverClass='press-dim' onClick={handlePickReference}>
              <Text className='composer-ref-plus'>+</Text>
              <Text className='composer-ref-label'>参考图</Text>
            </View>
          )}
          <View className='composer-launch' hoverClass='is-pressed' onClick={openComposer}>
            <Text>生成</Text>
            <Text>↑</Text>
          </View>
        </View>
      </View>

      <View className='home-workflows'>
        <View className='home-section-heading'>
          <Text className='home-section-title'>更多工具</Text>
          <Text className='home-section-caption'>按你的任务选择</Text>
        </View>
        <View className='workflow-row'>
          {QUICK_ACTIONS.map((item) => (
            <View
              key={item.label}
              className='workflow-item'
              hoverClass='press-dim'
              onClick={() => Taro.navigateTo({ url: item.path })}
            >
              <Text className='workflow-icon'>{item.mark}</Text>
              <Text className='workflow-label'>{item.label}</Text>
              <Text className='workflow-hint'>{item.hint}</Text>
              <Text className='workflow-cost'>
                <Text className='cost-mark'>✦</Text> {genCost} 点/次
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* 隐私弹窗必须是触发入口（`.composer-ref-add` / `.composer-ref-thumb`）的
          **兄弟节点**，不能嵌在里面 —— 那两层都带 onClick（选图），嵌进去的话
          点「同意」会冒泡上去、又触发一次选图，等于连弹两次系统相册。
          （同 `components/UploadSlot.tsx`：弹窗挂在触发入口旁，不挂页面级） */}
      <PrivacyGate />

      {/* 首页**不放底导**（王 2026-09-27 定）。
          原因：底导（734–803）会盖住 composer 卡操作行（785.4–828.4）约 40%，
          而首屏要让给创作入口。资产入口已挪到「我的」页（`.me-assets-entry`）——
          ⚠️ 撤底导时必须同时保证 `/pages/assets/index` 还有入口：
          实测那一页全项目**只有这里**指向它，撤掉就是孤儿页。 */}
    </View>
  )
}
