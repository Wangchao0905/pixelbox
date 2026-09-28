import { Textarea, View, Text } from '@tarojs/components'

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  maxlength?: number
  className?: string
}

/** 提示词输入区：前置图标 + 右下角字数 */
export default function PromptField({ value, onChange, placeholder, maxlength = 500, className = '' }: Props) {
  return (
    <View className={`prompt-field ${className}`}>
      <Text className='prompt-icon'>✧</Text>
      <Textarea
        className='prompt-textarea'
        value={value}
        placeholder={placeholder}
        placeholderClass='prompt-placeholder'
        maxlength={maxlength}
        autoHeight={false}
        onInput={(event) => onChange(event.detail.value)}
      />
      <Text className='prompt-count'>
        {value.length}/{maxlength}
      </Text>
    </View>
  )
}
