import { Icon } from '@/components/common/Icon'

// QuestGiver's AI settings (provider, model, API key, rate limits) are stored in
// the self-hosted HearthShelf backend on the server itself, not in ABS. The
// hosted app talks straight to ABS and has no path to that config, so this is an
// informative panel rather than the editable form.
export function ConfigQuestGiver() {
  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Admin</div>
        <h1 className="title-xl">QuestGiver</h1>
        <p className="page-sub">The next-listen matchmaker.</p>
      </div>

      <div className="empty-state">
        <Icon name="explore" />
        <h3>Configured on the server</h3>
        <p>
          QuestGiver's AI provider, model, and limits are managed on the server
          itself. Sign in on the server to change them.
        </p>
      </div>
    </>
  )
}
