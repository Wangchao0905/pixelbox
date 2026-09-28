import { useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { Button, Image, Text, View } from '@tarojs/components'
import Taro, { useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import { AppHeader, PrivacyGate } from '@/components'
import { editImages, generateImages, saveImageToAlbum } from '@/services/image-api'
import { aigcBadgeText, costForImages } from '@/services/account'
import { shortfallOf } from '@/services/api-error'
import { BATCH_SIZE } from '@/data/catalog'
import { rememberResult } from '@/services/history'
import { setReferenceDraft } from '@/services/reference-images'
import { setPendingResult, takePendingResult } from '@/services/result-store'

/**
 * 生成结果
 * ------------------------------------------------------------------
 * 对应原型 ResultScreen。
 * 数据通过 services/result-store 从生成页交接过来；如果拿不到（热重载、
 * 分享链接直接进入），走空状态而不是崩溃。
 * 进入页面时把本次结果写入本地历史，资产库据此展示。
 */
/**
 * 页面外壳：**顶栏只在这一处渲染**。
 * ------------------------------------------------------------------
 * 这个页面有两个出口（拿不到结果时的空态 / 正常态）。如果各自写一份
 * <AppHeader>，漏掉任何一条都会让用户卡在那里出不去 —— 而门禁只能证明
 * 「这个页面里有返回入口」，证明不了「两条路径都有」。所以收成唯一一处。
 */
function ResultShell({ children }: PropsWithChildren) {
  return (
    <View className='app-screen page-pad result-screen page-enter'>
      <AppHeader title='生成结果' />
      {children}
    </View>
  )
}

export default function Result() {
  const result = useMemo(() => takePendingResult(), [])
  const variants = useMemo(() => result?.images ?? [], [result])
  /**
   * 这一批是不是「多张」。整套文案/缩略条/序号角标都按它分叉。
   * ------------------------------------------------------------------
   * 起因：三个创作页的 `BATCH_SIZE = 1`（`data/catalog.ts`，三页共用一个值），
   * 而这一页的文案和缩略条还是**四张那版**。1 张时界面会显示
   * `1 DIRECTIONS GENERATED`（英文是错的）和「选一个你喜欢的方向」
   * （一句没有对象的话）—— 两条都不报错、不崩溃，用户只是看到一句莫名其妙的话。
   *
   * 张数的唯一真源就是 `variants.length`，这里不另写一份、也不读 BATCH_SIZE：
   * 页面渲染的是**实际拿到的图**，不是「本该有几张」。
   * ⚠️ 若将来 `BATCH_SIZE` 调回 4，四张那支原样生效，这里不用改回来。
   */
  const multiple = variants.length > 1
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const [rerunning, setRerunning] = useState(false)

  /**
   * 分享（好友 + 朋友圈）：小程序原生能力。
   * ------------------------------------------------------------------
   * 入口是下面的 `<Button openType='share'>`，点它弹出系统分享面板；
   * 面板里有没有「朋友圈」选项，取决于这里有没有 `showShareMenu` 打开
   * `shareTimeline` —— 缺了的话面板里只有「发送给朋友」。
   * `useShareTimeline` 的卡片点进去落在小程序首页（`query` 只能进首页这
   * 种 tab 页安全的路径），`from=share` 让首页知道这是被分享带进来的。
   * `imageUrl` 用当前选中的生成图：朋友圈卡片上直接看到这张 AI 图，
   * 点卡片才进小程序 —— 图是钩子，小程序是落点。
   * ⚠️ imageUrl 必须是 https 可访问的服务端地址，本地临时路径发不出去。
   */
  useEffect(() => {
    Taro.showShareMenu({
      withShareTicket: true,
      // 这个 Taro 版本的参数名叫 showShareItems（不是微信原生的 menus），
      // 值用 ['shareAppMessage', 'shareTimeline'] 即可打开「发送给朋友」+「分享到朋友圈」。
      showShareItems: ['shareAppMessage', 'shareTimeline']
    }).catch(() => undefined)
  }, [])

  const sharePayload = () => ({
    title: `我在像素盒子生成了一张「${result?.title ?? 'AI 作品'}」`,
    imageUrl: variants[selectedIndex]?.url
  })

  useShareAppMessage(() => ({
    ...sharePayload(),
    path: '/pages/home/index?from=share'
  }))

  useShareTimeline(() => ({
    ...sharePayload(),
    query: 'from=share'
  }))

  useEffect(() => {
    if (!result || !variants.length) return
    rememberResult({
      id: `${result.templateId}-${Date.now()}`,
      title: result.title,
      skill: result.skill,
      // 分类筛选靠它，见 HistoryItem 的注释。id 里虽然也含前缀，但那是拼接约定，
      // 不该让筛选去解析 id —— 显式带上字段。
      templateId: result.templateId,
      createdAt: new Date().toISOString(),
      images: variants.map((item) => item.url)
    })
  }, [result, variants])

  const handleExport = async () => {
    const selected = variants[selectedIndex]
    if (!selected) return
    setSaving(true)
    try {
      await saveImageToAlbum(selected.url)
      Taro.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (cause) {
      Taro.showToast({
        title: cause instanceof Error ? cause.message : '保存失败',
        icon: 'none'
      })
    } finally {
      setSaving(false)
    }
  }

  const useAsReference = () => {
    const selected = variants[selectedIndex]
    if (!selected) return
    setReferenceDraft({ path: selected.url, size: 0, name: 'generated-reference' })
    Taro.navigateTo({ url: '/pages/create-freeform/index' })
  }

  /**
   * 再来一张：一键复购。
   * ------------------------------------------------------------------
   * 用生成页存下的完整请求快照原样重跑 —— 用户刚拿到满意的图、正处在最愿意
   * 再花点的时刻，这是离钱最近的一次点击。成功后 redirectTo 自己：
   * 换掉当前页实例（避免结果页叠罗汉），新实例重新走一遍取数/入库/扫描线。
   * 点数不足走原生 modal，一步到充值页；其他错误 toast，不打断浏览。
   */
  const handleRerun = async () => {
    const rerun = result?.rerun
    if (!rerun || rerunning) return
    setRerunning(true)
    try {
      const images = rerun.kind === 'edit'
        ? await editImages(rerun.params)
        : await generateImages(rerun.params)
      setPendingResult({
        templateId: result.templateId,
        title: result.title,
        skill: result.skill,
        images,
        rerun
      })
      Taro.redirectTo({ url: '/pages/result/index' })
    } catch (cause) {
      const need = shortfallOf(cause, costForImages(rerun.params.n ?? BATCH_SIZE))
      if (need != null) {
        const answer = await Taro.showModal({
          title: '点数不足',
          content: `还需 ${need} 点，去充值？`,
          confirmText: '去充值',
          cancelText: '再想想'
        })
        if (answer.confirm) Taro.navigateTo({ url: '/pages/recharge/index' })
      } else {
        Taro.showToast({
          title: cause instanceof Error ? cause.message : '生成失败，请重试',
          icon: 'none'
        })
      }
    } finally {
      setRerunning(false)
    }
  }

  if (!variants.length) {
    return (
      <ResultShell>
        <View className='empty-assets'>
          <Text className='empty-mark'>✦</Text>
          <Text className='empty-title'>还没有生成结果</Text>
          <Text className='empty-copy'>回到首页挑一个模板，或直接用一句话自由生图。</Text>
          <View
            className='primary-cta'
            style={{ minHeight: '46px', padding: '0 20px', marginTop: '8px' }}
            hoverClass='is-pressed'
            onClick={() => Taro.reLaunch({ url: '/pages/home/index' })}
          >
            <Text>去创作</Text>
          </View>
        </View>
      </ResultShell>
    )
  }

  return (
    <ResultShell>
      <View className='result-intro result-page-head'>
        <Text className='result-overline'>{multiple ? `${variants.length} 张作品` : '作品已生成'}</Text>
        <View className='h2'>{multiple ? '挑一张继续创作' : '保存它，或用它继续创作'}</View>
        <Text className='result-copy'>
          {result?.title} · {result?.skill}
        </Text>
      </View>

      {/* 大图：把选中的那张放到最大。生成结果是付费主角，
          原来两列下每张只有 ~170px，用户判断不了质量 */}
      <View className='result-stage'>
        <Image className='result-img' src={variants[selectedIndex]?.url ?? ''} mode='aspectFill' />
        {/* 深空仪器：生成完成时 1px 信号线扫过一次 —— 「仪器刚校准完」的感觉。
            页面每次 navigateTo 都是新实例，动画只播一次，不干扰切图。 */}
        <View className='result-scan' />
        {/* AIGC 显式标识（《标识办法》第四条）：交互场景界面上必须有
            用户能明显感知到的提示，且文案由服务端下发。
            固定在左上角 —— services/export-image 合成到导出图上的位置
            就是照这里对齐的（「所见即所存」），所以不要挪动。 */}
        <Text className='aigc-badge is-top-left'>{aigcBadgeText()}</Text>
        {/* 序号角标：只有多张时才渲染。
            它的作用是「你现在看的是第几张 / 共几张」，指向的是下面的缩略条；
            1 张时缩略条不渲染（见下），这个角标就在**指示一条不存在的序列**，
            而 `01 / 01` 本身不构成任何信息。 */}
        {multiple ? (
          <Text className='result-stage-badge'>
            0{selectedIndex + 1} / 0{variants.length}
          </Text>
        ) : null}
      </View>

      {/* 缩略条：保留「多张同时可见」的对比能力。
          ⚠️ 只有 1 张时**不渲染** —— 缩略条的存在理由是「选哪张」，
          1 张时它没有可选的东西，而 `.result-strip` 是 `repeat(4, …)` 的定宽网格，
          一张图只占 23% 宽、右边留 3 个空槽（实测 83.3px / 357px）。
          那个样子看起来像加载失败，不像「只有一张」。
          为什么现在会是 1 张：`BATCH_SIZE = 1`（`data/catalog.ts`，三页共用），
          且自由生图的文案已经改成「为你生成一张作品」（设计稿还停在四张那版，
          两边对不上这件事**待王定**，见 `data/catalog.ts` 里 BATCH_SIZE 的注释）。
          ⇒ 若将来把 `BATCH_SIZE` 调回 4，这里什么都不用改，缩略条自动回来。 */}
      {multiple ? (
        <View className='result-strip'>
          {variants.map((item, index) => (
            <View
              key={`${item.url}-${index}`}
              className={`result-thumb ${index === selectedIndex ? 'is-selected' : ''}`}
              onClick={() => setSelectedIndex(index)}
            >
              <Image className='result-img' src={item.url} mode='aspectFill' />
              {/* 缩略图不重复打标（王 2026-09-20 定）。
                  理由：缩略图只有 56px 宽，is-compact 角标实测占掉 55% 宽度，
                  把图盖得看不清，而缩略图本来就是「选哪张」的按钮，不是用来看的。
                  合规不受影响 —— 这几张图会逐张在大图上显示，大图带标识（上面那处）；
                  保存/预览/分享三条导出路径另有合成收口。
                  ⚠️ 资产页的缩略图仍然每张都带：那一页整页只有缩略图，
                     去掉就等于整页没有可见标识，性质不同，别一起删。 */}
              {index === selectedIndex ? (
                <View className='result-check'>
                  <Text>✓</Text>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {/* 再来一张：全宽主按钮，复购权重最高，放在三个次级操作上面。
          没有 rerun 快照（老版本/异常进入）时不渲染，不占位。 */}
      {result?.rerun ? (
        <View
          className={`primary-cta result-rerun ${rerunning ? 'is-disabled' : ''}`}
          hoverClass={rerunning ? 'none' : 'is-pressed'}
          onClick={handleRerun}
        >
          {rerunning ? <View className='spinner' /> : null}
          <Text>{rerunning ? '生成中…' : '再来一张'}</Text>
        </View>
      ) : null}

      <View className='result-action-row'>
        <View
          className='result-action result-action-reference'
          hoverClass='is-pressed'
          onClick={useAsReference}
        >
          <Text className='result-action-icon'>↗</Text>
          <Text>作为参考图</Text>
        </View>
        <View
          className={`result-action result-action-save ${saving ? 'is-disabled' : ''}`}
          hoverClass={saving ? 'none' : 'is-pressed'}
          onClick={() => {
            if (!saving) handleExport()
          }}
        >
          <Text className='result-action-icon'>↓</Text>
          <Text>{saving ? '保存中…' : '保存到相册'}</Text>
        </View>
        {/*
          分享按钮：必须是 Button + openType='share'，View 调不出系统分享面板。
          点它走上面注册的 useShareAppMessage / useShareTimeline，
          面板里「发送给朋友」和「分享到朋友圈」两个入口都在。
        */}
        <Button
          className='result-action result-action-share'
          openType='share'
          hoverClass='is-pressed'
        >
          <Text className='result-action-icon'>⇪</Text>
          <Text>分享</Text>
        </Button>
      </View>

      <View className='result-secondary-action' hoverClass='press-dim' onClick={() => Taro.navigateBack()}>
        <Text>返回继续编辑</Text>
      </View>
      <Text className='result-saved-note'>本次生成已存入资产库</Text>

      {/* 导出图片要写相册（隐私接口），弹窗组件挂在本页 */}
      <PrivacyGate />
    </ResultShell>
  )
}
