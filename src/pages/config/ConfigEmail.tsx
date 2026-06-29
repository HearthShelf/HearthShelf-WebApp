import { useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getEmailSettings,
  updateEmailSettings,
  sendTestEmail,
  updateEreaderDevices,
  adminContentKeys,
  type ABSEmailSettings,
  type ABSEreaderDevice,
} from '@/api/absAdmin'
import { useActiveServer } from '@/hooks/useActiveServer'
import { Icon } from '@/components/common/Icon'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'

// Email (editable SMTP form + eReader devices). Thin wrapper: fetches settings,
// then mounts the form keyed on the loaded data so form state initializes
// directly from props (no setState-in-effect sync).
export function ConfigEmail() {
  const { target } = useActiveServer()
  const { data } = useQuery({
    queryKey: adminContentKeys.email(target?.serverId ?? ''),
    queryFn: () => getEmailSettings(target!),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
  })

  if (!data) {
    return (
      <>
        <div className="page-head">
          <div className="eyebrow">Admin</div>
          <h1 className="title-xl">Email</h1>
        </div>
        <LoadingSpinner className="py-12" label="Loading..." />
      </>
    )
  }

  return <EmailForm key={JSON.stringify(data.settings)} settings={data.settings} />
}

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

function EmailForm({ settings }: { settings: ABSEmailSettings }) {
  const qc = useQueryClient()
  const { target } = useActiveServer()

  const [host, setHost] = useState(settings.host ?? '')
  const [port, setPort] = useState(settings.port != null ? String(settings.port) : '465')
  const [secure, setSecure] = useState(settings.secure)
  const [user, setUser] = useState(settings.user ?? '')
  const [pass, setPass] = useState('')
  const [fromAddress, setFromAddress] = useState(settings.fromAddress ?? '')
  const [testAddress, setTestAddress] = useState(settings.testAddress ?? '')
  const [devices, setDevices] = useState<ABSEreaderDevice[]>(settings.ereaderDevices ?? [])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<string | null>(null)

  const invalidate = () => {
    if (target) qc.invalidateQueries({ queryKey: adminContentKeys.email(target.serverId) })
  }

  const save = async () => {
    if (!target) return
    setSaving(true)
    try {
      await updateEmailSettings(target, {
        host: host || null,
        port: port ? Number(port) : null,
        secure,
        user: user || null,
        fromAddress: fromAddress || null,
        testAddress: testAddress || null,
        // pass is write-only; only send when the admin typed a new one
        ...(pass ? { pass } : {}),
      })
      setPass('')
      invalidate()
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    if (!target) return
    setTesting(true)
    setTestMsg(null)
    try {
      await sendTestEmail(target)
      setTestMsg('Test email sent.')
    } catch {
      setTestMsg('Test failed - check the SMTP settings and save first.')
    } finally {
      setTesting(false)
      window.setTimeout(() => setTestMsg(null), 4000)
    }
  }

  const saveDevices = async (next: ABSEreaderDevice[]) => {
    if (!target) return
    setDevices(next)
    await updateEreaderDevices(target, next)
    invalidate()
  }

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Admin</div>
        <h1 className="title-xl">Email</h1>
        <p className="page-sub">SMTP server used to send ebooks to e-readers.</p>
      </div>

      <div className="cfg-card">
        <Field label="SMTP host">
          <input
            className="fld"
            placeholder="smtp.example.com"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
        </Field>
        <Field label="Port">
          <input
            className="fld"
            inputMode="numeric"
            placeholder="465"
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))}
          />
        </Field>
        <div className="cfg-line">
          <Icon name="lock" style={{ color: 'var(--text-muted)' }} />
          <div className="cl-meta" style={{ flex: 1 }}>
            <div className="cl-t">Use TLS</div>
            <div className="cl-d">Secure connection (recommended for port 465).</div>
          </div>
          <button
            className={secure ? 'toggle on' : 'toggle'}
            aria-pressed={secure}
            onClick={() => setSecure((v) => !v)}
          >
            <i />
          </button>
        </div>
        <Field label="Username">
          <input
            className="fld"
            placeholder="user@example.com"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
        </Field>
        <Field label="Password">
          <input
            className="fld"
            type="password"
            placeholder={settings.host ? 'Leave blank to keep current' : ''}
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
        </Field>
        <Field label="From address">
          <input
            className="fld"
            placeholder="library@example.com"
            value={fromAddress}
            onChange={(e) => setFromAddress(e.target.value)}
          />
        </Field>
        <Field label="Test recipient">
          <input
            className="fld"
            placeholder="you@example.com"
            value={testAddress}
            onChange={(e) => setTestAddress(e.target.value)}
          />
        </Field>
        <div className="cfg-line" style={{ gap: 8, justifyContent: 'flex-end' }}>
          {testMsg && (
            <span style={{ color: 'var(--text-muted)', fontSize: 12.5, marginRight: 'auto' }}>
              {testMsg}
            </span>
          )}
          <button
            className="btn-sm"
            disabled={testing || !testAddress}
            onClick={() => void test()}
          >
            <Icon name="send" /> {testing ? 'Sending...' : 'Send test'}
          </button>
          <button className="btn-sm btn-green" disabled={saving} onClick={() => void save()}>
            {saved ? <Icon name="check" /> : <Icon name="save" />}{' '}
            {saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

      <EreaderDevices devices={devices} onChange={saveDevices} />
    </>
  )
}

function EreaderDevices({
  devices,
  onChange,
}: {
  devices: ABSEreaderDevice[]
  onChange: (next: ABSEreaderDevice[]) => void | Promise<void>
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  const add = () => {
    if (!name.trim() || !email.trim()) return
    void onChange([...devices, { name: name.trim(), email: email.trim() }])
    setName('')
    setEmail('')
  }
  const remove = (idx: number) => {
    void onChange(devices.filter((_, i) => i !== idx))
  }

  return (
    <>
      <div className="section-head" style={{ marginTop: 'var(--s6)' }}>
        <Icon name="tablet" />
        <h2>E-reader devices · {devices.length}</h2>
      </div>
      <div className="cfg-card">
        {devices.map((d, i) => (
          <div className="cfg-line" key={`${d.email}-${i}`}>
            <Icon name="tablet" style={{ color: 'var(--text-muted)' }} />
            <div className="cl-meta" style={{ flex: 1 }}>
              <div className="cl-t">{d.name}</div>
              <div className="cl-d">{d.email}</div>
            </div>
            <button className="tbl-icon" title="Remove device" onClick={() => remove(i)}>
              <Icon name="delete" />
            </button>
          </div>
        ))}
        <div className="cfg-line" style={{ gap: 8 }}>
          <input
            className="fld"
            placeholder="Device name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="fld"
            placeholder="device@kindle.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            className="btn-sm"
            style={{ flex: 'none' }}
            disabled={!name.trim() || !email.trim()}
            onClick={add}
          >
            <Icon name="add" /> Add
          </button>
        </div>
      </div>
    </>
  )
}
