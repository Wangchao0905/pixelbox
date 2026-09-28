import { useCallback, useRef, useState } from 'react'
import { Image, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { AppHeader, BottomNav } from '@/components'
import { currentAigcLabel } from '@/services/account'
import { deleteAsset, loadAssets } from '@/services/assets'
import { assetMatchesFilter, type AssetFilter } from '@/services/create-ui'
import { previewLabeledImages } from '@/services/export-image'
import { formatTime, type HistoryItem } from '@/services/history'

/**
 * 骨架屏的假形状：2 组 × 4 格。
 *
 * 🔴 占位块**故意复用真实列表的类**（`.asset-group` / `.asset-grid` /
 *    `.asset-cell` / `.asset-img`）—— 这样几何**不可能漂**：
 *    `.asset-grid .asset-img` 那条规则同时管着真图和占位块。
 *    另写一套 `skeleton-cell-*` 会漂，而漂开的表现是「数据到了之后
 *    卡片高度跳一下」——不报错，只是看着廉价。
 */
const SKELETON_GROUPS = [0, 1]
const SKELETON_CELLS = [0, 1, 2, 3]

/**
 * 资产库
 * ------------------------------------------------------------------
 * 对应原型 AssetsScreen。
 *
 * 数据源是**服务端资产库**（`GET /api/assets`），不是本地缓存：
 * 本地缓存上限约 10MB、卸载即丢、换手机不同步，而这些图是用户花钱
 * 生成的，丢了就是客服工单。本地只在服务端不可达时兜底，并且会
 * 明确告诉用户「现在看到的是本机残留，不是全部」——
 * 悄悄少显示几张，用户会以为作品丢了。
 */
export default function Assets() {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState<AssetFilter>('all')
  // 只有服务端列表里的 id 才删得掉。降级到本地缓存时列表来自本机残留，
  // 那些 id 和服务端的对不上（服务端是 asset_xxx，本机是模板名+时间戳），
  // 拿它们去 DELETE 会 404，用户会看到「删了又回来」。所以离线时禁止删除。
  const [canDelete, setCanDelete] = useState(false)

  // 只有首次进入才显示 loading。之后每次切回来都静默刷新，
  // 否则生成完返回资产库会闪一下空白，像是作品没存上。
  const loadedOnce = useRef(false)

  const refresh = useCallback(async () => {
    const result = await loadAssets()
    setItems(result.items)
    setCanDelete(result.source === 'server')
    setNotice(
      result.source === 'cache' && result.degradedReason
        ? `离线模式 · 只显示本机缓存的作品（${result.degradedReason}）`
        : ''
    )
    loadedOnce.current = true
    setLoading(false)
  }, [])

  useDidShow(() => {
    void refresh()
  })

  const confirmDelete = useCallback(
    (item: HistoryItem) => {
      if (!canDelete) {
        Taro.showToast({ title: '离线状态下无法删除，请联网后重试', icon: 'none' })
        return
      }

      void (async () => {
        const answer = await Taro.showModal({
          title: '删除作品',
          content: `「${item.title}」及其 ${item.images.length} 张图片会从资产库移除，且不可恢复。`,
          confirmText: '删除',
          cancelText: '取消'
        })
        if (!answer.confirm) return

        try {
          await deleteAsset(item.id)
          // 本地先摘掉，不必等服务端回包：删除是幂等的，失败时下次
          // 刷新会把服务端列表拉回来，不会造成「以为删了其实没删」。
          setItems((prev) => prev.filter((entry) => entry.id !== item.id))
          Taro.showToast({ title: '已删除', icon: 'success' })
        } catch (error) {
          Taro.showToast({
            title: error instanceof Error ? error.message : '删除失败',
            icon: 'none'
          })
        }
      })()
    },
    [canDelete]
  )

  const showEmpty = !loading && !items.length
  const aigcLabel = currentAigcLabel()
  const visibleItems = items.filter((item) => assetMatchesFilter(item, filter))

  return (
    <View className='app-screen page-pad has-nav page-enter'>
      <AppHeader title='资产库' />
      <View className='result-intro'>
        <Text className='library-overline'>YOUR LIBRARY</Text>
        <View className='library-title-row'>
          <View className='h2'>你的作品</View>
          <Text className='library-count'>{items.length}</Text>
        </View>
        <Text className='result-copy'>{items.length ? '按时间浏览每一次创作' : '生成后的作品会自动保存在这里'}</Text>
      </View>

      <View className='asset-filter-row'>
        {([
          ['all', '全部'],
          ['freeform', '自由生图'],
          ['poster', '海报'],
          ['product', '产品'],
          ['avatar', '头像'],
          ['reference', '灵感复刻']
        ] as const).map(([key, label]) => (
          <View
            key={key}
            className={`asset-filter ${filter === key ? 'is-active' : ''}`}
            hoverClass='press-dim'
            onClick={() => setFilter(key)}
          >
            <Text>{label}</Text>
          </View>
        ))}
      </View>

      {notice ? <Text className='asset-notice'>{notice}</Text> : null}

      {/* 首屏骨架屏（2026-09-27）。只在这一页 —— 全项目只有资产库真的
          异步取数据（`loadAssets()` → 服务端）。产品工作室 / 头像模板库是
          本地常量同步渲染，给它们加骨架屏**永远不会显示**。
          只在**首次**进入时显示；之后切回来是静默刷新（见 loadedOnce）。 */}
      {loading && !loadedOnce.current ? (
        <View className='asset-skeleton skeleton-pulse'>
          {SKELETON_GROUPS.map((group) => (
            <View className='asset-group' key={group}>
              <View className='asset-group-heading'>
                <View className='asset-skeleton-bar is-title' />
                <View className='asset-skeleton-bar is-meta' />
              </View>
              <View className='asset-grid'>
                {SKELETON_CELLS.map((cell) => (
                  <View className='asset-cell' key={cell}>
                    <View className='asset-img' />
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {visibleItems.length ? (
        <View className='asset-list'>
          {visibleItems.map((item) => (
            <View
              className='asset-group'
              key={item.id}
              onLongPress={() => confirmDelete(item)}
            >
              <View className='asset-group-heading'>
                <Text className='asset-title'>{item.title}</Text>
                <Text className='asset-skill'>
                  {item.skill} · {formatTime(item.createdAt)}
                </Text>
              </View>
              <View className='asset-grid'>
                {item.images.map((image, index) => (
                  <View className='asset-cell' key={`${item.id}-${index}`}>
                    <Image
                      className='asset-img'
                      src={image}
                      mode='aspectFill'
                      lazyLoad
                      onClick={() => void previewLabeledImages(item.images, image)}
                    />
                    {/* AIGC 显式标识（《标识办法》第四条）。缩略图上只放文案，
                        署名主体在结果页与文件元数据里都有，不必挤在这么小的图上 */}
                    <Text className='aigc-badge is-bottom-left is-compact'>{aigcLabel}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
          <Text className='asset-hint'>
            {canDelete ? '长按作品可删除' : '联网后可长按删除作品'}
          </Text>
        </View>
      ) : null}

      {!loading && items.length && !visibleItems.length ? (
        <View className='asset-filter-empty'>
          <Text>这个分类还没有作品</Text>
          <Text>换个分类看看，或开始新的创作。</Text>
        </View>
      ) : null}

      {showEmpty ? (
        <View className='empty-assets'>
          <Text className='empty-mark'>▣</Text>
          <Text className='empty-title'>还没有作品</Text>
          <Text className='empty-copy'>完成一次生成后，作品会自动出现在这里。</Text>
          <View
            className='primary-cta'
            style={{ minHeight: '46px', padding: '0 20px', marginTop: '8px' }}
            hoverClass='is-pressed'
            onClick={() => Taro.reLaunch({ url: '/pages/home/index' })}
          >
            <Text>去创作</Text>
          </View>
        </View>
      ) : null}

      <BottomNav active='assets' />
    </View>
  )
}
