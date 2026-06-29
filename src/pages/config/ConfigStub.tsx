import { Icon } from '@/components/common/Icon'

const TITLES: Record<string, { title: string; note: string }> = {
  settings: {
    title: 'Settings',
    note: 'General server settings are coming in a later pass.',
  },
  'service-accounts': {
    title: 'Service Accounts',
    note: 'Machine-account management is coming in a later pass.',
  },
  apikeys: {
    title: 'API Keys',
    note: 'API key management is coming in a later pass.',
  },
  sessions: {
    title: 'Listening Sessions',
    note: 'Server-wide listening session history is coming in a later pass.',
  },
  backups: {
    title: 'Backups',
    note: 'Backup management is coming in a later pass.',
  },
  logs: {
    title: 'Logs',
    note: 'Server log streaming is coming in a later pass.',
  },
  integrations: {
    title: 'Integrations',
    note: 'External link providers and acquisition integrations are coming in a later pass.',
  },
  notifications: {
    title: 'Notifications',
    note: 'Notification rules configuration is coming in a later pass.',
  },
  email: {
    title: 'Email',
    note: 'SMTP / email settings configuration is coming in a later pass.',
  },
  meta: {
    title: 'Metadata Utils',
    note: 'Genre and tag management tools are coming in a later pass.',
  },
  rss: {
    title: 'RSS Feeds',
    note: 'RSS feed management is coming in a later pass.',
  },
  auth: {
    title: 'Authentication',
    note: 'Auth / OIDC provider configuration is coming in a later pass.',
  },
  questgiver: {
    title: 'QuestGiver',
    note: 'QuestGiver configuration is coming in a later pass.',
  },
  connect: {
    title: 'HearthShelf Connect',
    note: 'Connect / pairing settings are coming in a later pass.',
  },
  community: {
    title: 'Community',
    note: 'Community settings are coming in a later pass.',
  },
  serverstats: {
    title: 'Server Stats',
    note: 'Server-wide aggregate stats are coming in a later pass.',
  },
  libstats: {
    title: 'Library Stats',
    note: 'Library aggregate stats are coming in a later pass.',
  },
  mystats: {
    title: 'Your Stats',
    note: 'Your personal stats live on the main Stats page.',
  },
}

export function ConfigStub({ section }: { section: string }) {
  const info = TITLES[section] ?? {
    title: 'Coming soon',
    note: 'This admin section is still being built.',
  }
  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Admin</div>
        <h1 className="title-xl">{info.title}</h1>
      </div>
      <div className="empty-state">
        <Icon name="construction" />
        <h3>Not available yet</h3>
        <p>{info.note}</p>
      </div>
    </>
  )
}
