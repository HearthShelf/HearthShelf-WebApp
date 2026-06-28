import { Icon } from '@/components/common/Icon'

export function NarratorsPage() {
  return (
    <div className="page fade-in">
      <div className="page-head">
        <div className="eyebrow">The voices</div>
        <h1 className="title-xl">Narrators</h1>
      </div>

      <div className="empty-state">
        <Icon name="mic" />
        <h3>Narrators coming soon</h3>
        <p>Browsing your library by narrator isn&apos;t available here yet.</p>
      </div>
    </div>
  )
}
