import { Icon } from '@/components/common/Icon'

interface AccountInfoTipProps {
  text: string
}

/** Compact help that works with a mouse, keyboard, or tap. */
export function AccountInfoTip({ text }: AccountInfoTipProps) {
  return (
    <span className="account-info-tip" tabIndex={0} role="note" aria-label={text} data-tip={text}>
      <Icon name="info" />
    </span>
  )
}
