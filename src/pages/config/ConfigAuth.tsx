import { useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getAuthSettings,
  updateAuthSettings,
  adminContentKeys,
  type ABSAuthSettings,
} from '@/api/absAdmin'
import { useActiveServer } from '@/hooks/useActiveServer'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="cfg-line" style={{ gap: 12 }}>
      <div className="cl-meta" style={{ width: 150, flex: 'none' }}>
        <div className="cl-t">{label}</div>
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

// Authentication (editable: method toggles + OIDC form).
export function ConfigAuth() {
  const { target } = useActiveServer()
  const { data } = useQuery({
    queryKey: adminContentKeys.auth(target?.serverId ?? ''),
    queryFn: () => getAuthSettings(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })

  if (!data) {
    return (
      <>
        <div className="page-head">
          <div className="eyebrow">Admin</div>
          <h1 className="title-xl">Authentication</h1>
        </div>
        <LoadingSpinner className="py-12" label="Loading..." />
      </>
    )
  }

  return <AuthForm key={JSON.stringify(data)} settings={data} />
}

function AuthForm({ settings }: { settings: ABSAuthSettings }) {
  const qc = useQueryClient()
  const { target } = useActiveServer()

  const [methods, setMethods] = useState<string[]>(settings.authActiveAuthMethods ?? ['local'])
  const [oidc, setOidc] = useState({
    authOpenIDIssuerURL: settings.authOpenIDIssuerURL ?? '',
    authOpenIDClientID: settings.authOpenIDClientID ?? '',
    authOpenIDButtonText: settings.authOpenIDButtonText ?? '',
    authOpenIDAutoLaunch: settings.authOpenIDAutoLaunch ?? false,
    authOpenIDAutoRegister: settings.authOpenIDAutoRegister ?? false,
  })
  const [clientSecret, setClientSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const openidOn = methods.includes('openid')
  const toggleMethod = (m: string) => {
    setMethods((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]))
  }

  const save = async () => {
    if (!target) return
    setSaving(true)
    try {
      const patch: Partial<ABSAuthSettings> & { authOpenIDClientSecret?: string } = {
        authActiveAuthMethods: methods.length ? methods : ['local'],
        ...oidc,
        authOpenIDIssuerURL: oidc.authOpenIDIssuerURL || null,
        authOpenIDClientID: oidc.authOpenIDClientID || null,
        authOpenIDButtonText: oidc.authOpenIDButtonText || null,
        ...(clientSecret ? { authOpenIDClientSecret: clientSecret } : {}),
      }
      await updateAuthSettings(target, patch)
      setClientSecret('')
      qc.invalidateQueries({ queryKey: adminContentKeys.auth(target.serverId) })
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Admin</div>
        <h1 className="title-xl">Authentication</h1>
      </div>

      <div className="cfg-card">
        <div className="cfg-line">
          <Icon name="password" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1 }}>
            <div className="cl-t">Local accounts</div>
            <div className="cl-d">Username and password sign-in.</div>
          </div>
          <button
            className={methods.includes('local') ? 'toggle on' : 'toggle'}
            aria-pressed={methods.includes('local')}
            onClick={() => toggleMethod('local')}
          >
            <i />
          </button>
        </div>
        <div className="cfg-line">
          <Icon name="key" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1 }}>
            <div className="cl-t">OpenID Connect</div>
            <div className="cl-d">Single sign-on through an identity provider.</div>
          </div>
          <button
            className={openidOn ? 'toggle on' : 'toggle'}
            aria-pressed={openidOn}
            onClick={() => toggleMethod('openid')}
          >
            <i />
          </button>
        </div>
      </div>

      {openidOn && (
        <>
          <div className="section-head" style={{ marginTop: 'var(--s6)' }}>
            <Icon name="key" />
            <h2>OpenID Connect</h2>
          </div>
          <div className="cfg-card">
            <Field label="Issuer URL">
              <input
                className="fld"
                placeholder="https://idp.example.com"
                value={oidc.authOpenIDIssuerURL}
                onChange={(e) => setOidc((o) => ({ ...o, authOpenIDIssuerURL: e.target.value }))}
              />
            </Field>
            <Field label="Client ID">
              <input
                className="fld"
                value={oidc.authOpenIDClientID}
                onChange={(e) => setOidc((o) => ({ ...o, authOpenIDClientID: e.target.value }))}
              />
            </Field>
            <Field label="Client secret">
              <input
                className="fld"
                type="password"
                placeholder={settings.authOpenIDClientID ? 'Leave blank to keep current' : ''}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </Field>
            <Field label="Button text">
              <input
                className="fld"
                placeholder="Sign in with SSO"
                value={oidc.authOpenIDButtonText}
                onChange={(e) => setOidc((o) => ({ ...o, authOpenIDButtonText: e.target.value }))}
              />
            </Field>
            <div className="cfg-line">
              <Icon name="rocket_launch" style={{ color: 'var(--text-muted)' }} />
              <div className="cl-meta" style={{ flex: 1 }}>
                <div className="cl-t">Auto-launch</div>
                <div className="cl-d">Skip the login screen and go straight to the provider.</div>
              </div>
              <button
                className={oidc.authOpenIDAutoLaunch ? 'toggle on' : 'toggle'}
                aria-pressed={oidc.authOpenIDAutoLaunch}
                onClick={() =>
                  setOidc((o) => ({ ...o, authOpenIDAutoLaunch: !o.authOpenIDAutoLaunch }))
                }
              >
                <i />
              </button>
            </div>
            <div className="cfg-line">
              <Icon name="person_add" style={{ color: 'var(--text-muted)' }} />
              <div className="cl-meta" style={{ flex: 1 }}>
                <div className="cl-t">Auto-register</div>
                <div className="cl-d">Create an account on first sign-in.</div>
              </div>
              <button
                className={oidc.authOpenIDAutoRegister ? 'toggle on' : 'toggle'}
                aria-pressed={oidc.authOpenIDAutoRegister}
                onClick={() =>
                  setOidc((o) => ({ ...o, authOpenIDAutoRegister: !o.authOpenIDAutoRegister }))
                }
              >
                <i />
              </button>
            </div>
          </div>
        </>
      )}

      <div
        className="cfg-line"
        style={{ gap: 8, justifyContent: 'flex-end', marginTop: 'var(--s5)' }}
      >
        <button className="btn-sm btn-green" disabled={saving} onClick={() => void save()}>
          {saved ? <Icon name="check" /> : <Icon name="save" />} {saved ? 'Saved' : 'Save'}
        </button>
      </div>
    </>
  )
}
