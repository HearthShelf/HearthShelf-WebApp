import { Icon } from '@/components/common/Icon'

interface SectionHeadProps {
  icon: string
  title: string
}

// Heads every shelf section: icon + title (matches the design's section-head markup).
export function SectionHead({ icon, title }: SectionHeadProps) {
  return (
    <div className="section-head">
      <Icon name={icon} />
      <h2>{title}</h2>
    </div>
  )
}
