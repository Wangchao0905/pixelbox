import type { CSSProperties } from 'react'
import { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { AppHeader } from '@/components'
import {
  getAccount,
  isPassActive,
  readCachedBalance,
  type AccountSnapshot
} from '@/services/account'

/**
 * 「我的」
 * ==================================================================
 * 王的原话：「点数展示模块不应该放在首页，应该放在我的里面」，
 * 内容 = 账号信息 + 点数 + 充值；入口是首页右上角的头像。
 *
 * 布局照 savee 的 profile 页：没有标题栏文案堆叠，头像居中，
 * 下面一行四列统计（数字在上、标签在下），再下面是内容区。
 *
 * ⚠️ 必须渲染 <AppHeader>：navigationStyle 是 custom，微信不提供返回箭头，
 *    少了它这个页面就没有出口。这条已钉进 scripts/verify-dist.mjs 的
 *    HEADER_PAGES 表 —— **新页面要同时加进那张表**，否则门禁不覆盖它。
 *    标题字面量必须与表里完全一致。
 */

/** 有效期剩余天数；没有权益返回 null */
function passDaysLeft(passExpiresAt: string | null): number | null {
  if (!passExpiresAt) return null
  const end = new Date(passExpiresAt).getTime()
  if (Number.isNaN(end)) return null
  const days = Math.ceil((end - Date.now()) / 86400000)
  return days > 0 ? days : 0
}

/** 「09-22 18:30」。后端给的是 ISO 串，直接 new Date 解析 */
function shortTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const TRANSACTION_TITLES: Record<string, string> = {
  generate: '生成图片',
  edit: '产品替换',
  recharge: '充值',
  pass: '权益开通',
  refund: '退款回收'
}

export default function Profile() {
  const [snapshot, setSnapshot] = useState<AccountSnapshot | null>(null)
  const [failed, setFailed] = useState(false)

  useDidShow(() => {
    getAccount()
      .then((data) => {
        setSnapshot(data)
        setFailed(false)
      })
      .catch(() => setFailed(true))
  })

  // 服务端还没回来时先用本地缓存的余额，避免闪一个 0
  const balance = snapshot?.balance ?? readCachedBalance() ?? null
  const days = passDaysLeft(snapshot?.passExpiresAt ?? null)
  const generated = snapshot
    ? snapshot.transactions.filter((item) => item.type === 'generate' || item.type === 'edit').length
    : null
  const records = snapshot?.transactions.slice(0, 3) ?? []

  const stats = [
    { value: balance === null ? '—' : String(balance), label: '点数' },
    { value: snapshot ? String(snapshot.imageCost) : '—', label: '单张消耗' },
    { value: days === null ? '—' : String(days), label: '权益天数' },
    { value: generated === null ? '—' : String(generated), label: '已生成' }
  ]

  return (
    <View className='app-screen me-page page-enter' style={{ '--safe-t': '0px' } as CSSProperties}>
      <AppHeader title='我的' />

      <View className='me-identity'>
        <View className='me-avatar'>
          <Text>◉</Text>
        </View>
        <Text className='me-name'>像素盒子用户</Text>
        <Text className='me-sub'>
          {isPassActive(snapshot?.passExpiresAt ?? null) ? '创作权益已开通' : '未开通创作权益'}
        </Text>

        <View className='me-stats'>
          {stats.map((item) => (
            <View key={item.label} className='me-stat'>
              <Text className='me-stat-value'>{item.value}</Text>
              <Text className='me-stat-label'>{item.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View className='me-balance-card'>
        <View className='me-balance-row'>
          <Text className='me-balance-value'>{balance === null ? '—' : balance}</Text>
          <Text className='me-balance-unit'>点</Text>
        </View>
        <Text className='me-balance-note'>
          {snapshot
            ? `每张图消耗 ${snapshot.imageCost} 点，点数不足时无法提交生成。`
            : '正在读取账户信息…'}
        </Text>
        <View
          className='me-recharge'
          hoverClass='is-pressed'
          onClick={() => Taro.navigateTo({ url: '/pages/recharge/index' })}
        >
          <Text>充值点数</Text>
        </View>
      </View>

      {/* 「我的资产」入口（2026-09-27 加）。
          背景：首页撤掉底导后，`/pages/assets/index` 全项目唯一的入口没了 ——
          实测那一页只被 `app.config.ts`（路由注册）和 `data/app-nav.ts`
          （底导数据源）引用，**没有任何跳转指向它**。王定：入口放进「我的」。
          跳转用 navigateTo（与上面的「充值点数」一致），返回箭头可回本页。 */}
      <View
        className='me-assets-entry'
        hoverClass='press-dim'
        onClick={() => Taro.navigateTo({ url: '/pages/assets/index' })}
      >
        <Text className='me-assets-label'>我的资产</Text>
        <Text className='me-assets-arrow'>›</Text>
      </View>

      <Text className='me-section-title'>最近记录</Text>
      {records.length === 0 ? (
        <Text className='me-empty'>
          {failed ? '读取失败，下拉重进试试。' : '还没有记录。'}
        </Text>
      ) : (
        records.map((item) => (
          <View key={item.id} className='me-record'>
            <View>
              <Text className='me-record-title'>
                {TRANSACTION_TITLES[item.type] ?? item.title}
              </Text>
              <Text className='me-record-time'>{shortTime(item.createdAt)}</Text>
            </View>
            <Text className={`me-record-amount ${item.status === 'pending' ? 'is-pending' : ''}`}>
              {item.amount > 0 ? `+${item.amount}` : String(item.amount)}
            </Text>
          </View>
        ))
      )}
    </View>
  )
}
