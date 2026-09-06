import { Icon } from '@/components/common/Icon'

interface SectionHeadProps {
  icon?: string
  title: string
  onMore?: () => void
  /** 'suggested' steps the head down a tier, so an algorithmic row never reads
   *  as loud as the reader's own shelf. */
  tier?: 'primary' | 'suggested'
}

// Heads every shelf/section: optional icon + title + optional "See all" link.
export function SectionHead({ icon, title, onMore, tier }: SectionHeadProps) {
  return (
    <div className={'section-head' + (tier === 'suggested' ? ' is-suggested' : '')}>
      {icon && <Icon name={icon} />}
      <h2>{title}</h2>
      {onMore && (
        <button className="more" onClick={onMore}>
          See all →
        </button>
      )}
    </div>
  )
}
