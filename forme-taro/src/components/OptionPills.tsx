import { View, Text } from '@tarojs/components'
import type { SelectOption } from './SelectField'

type Props = {
  label: string
  value: string
  options: readonly SelectOption[]
  /**
   * 选中的胶囊前面加一个 ✓。
   * ------------------------------------------------------------------
   * 默认 **false**，老页面渲染结果一字不变。
   *
   * 为什么需要它：`.pill.is-selected` 只改边框色和文字色 —— 那是**纯颜色**
   * 的表达。无障碍要求「选中状态不能仅靠颜色表达」，所以需要它的页面
   * （如灵感复刻）显式打开，让 ✓ 这个字形把状态说清楚：
   * 读屏能读到、低对比度看得见、黑白截图也分得出。
   */
  showSelectedMark?: boolean
  onChange: (value: string) => void
}

/** 一行「标签 + 胶囊选项」，用于模型 / 清晰度 / 画面比例 / 复刻重点 */
export default function OptionPills({ label, value, options, showSelectedMark, onChange }: Props) {
  return (
    <View className='option-row'>
      <Text className='option-label'>{label}</Text>
      <View className='option-pills'>
        {options.map((option) => {
          const selected = value === option.value
          return (
            <Text
              key={option.value}
              className={`pill ${selected ? 'is-selected' : ''}`}
              onClick={() => onChange(option.value)}
            >
              {/* 直接拼字符串，不套嵌套 <Text>：少一层元素，也不会多出空节点 */}
              {showSelectedMark && selected ? '✓ ' : ''}
              {option.label}
            </Text>
          )
        })}
      </View>
    </View>
  )
}
