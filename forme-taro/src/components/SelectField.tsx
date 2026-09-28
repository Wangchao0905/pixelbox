import { Picker, View, Text } from '@tarojs/components'

export type SelectOption = { value: string; label: string }

type Props = {
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  compact?: boolean
  placeholder?: string
}

/**
 * 下拉选择
 * ------------------------------------------------------------------
 * 小程序没有 <select>，统一用 Picker 承载选择行为，
 * 外层 View 复刻原型里 direction-select / option-select 的外观。
 */
export default function SelectField({ value, options, onChange, compact, placeholder = '请选择' }: Props) {
  const list = options as SelectOption[]
  const index = list.findIndex((item) => item.value === value)
  const current = index >= 0 ? list[index] : undefined

  return (
    <Picker
      mode='selector'
      range={list.map((item) => item.label)}
      value={index >= 0 ? index : 0}
      onChange={(event) => {
        const next = list[Number(event.detail.value)]
        if (next) onChange(next.value)
      }}
    >
      <View className={`select-field ${compact ? 'is-compact' : ''}`}>
        <Text className='select-value'>{current?.label ?? placeholder}</Text>
        <Text className='select-caret'>▾</Text>
      </View>
    </Picker>
  )
}
