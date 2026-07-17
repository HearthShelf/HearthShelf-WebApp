import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getLibrariesAdmin, getAllTagNames, adminKeys } from '@/api/absAdmin'
import type { ABSAdminUser, ABSUserPermissions, ABSUserType } from '@/api/absAdmin'
import type { AbsTarget } from '@/api/absLibrary'
import { Icon } from '@/components/common/Icon'
import { Modal } from '@/components/common/Modal'
import { defaultPermissions } from './EditPermissionsModal'

const TYPES: { value: ABSUserType; label: string }[] = [
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
  { value: 'guest', label: 'Guest' },
]

const PERM_TOGGLES: { key: keyof ABSUserPermissions; label: string }[] = [
  { key: 'download', label: 'Can Download' },
  { key: 'update', label: 'Can Update' },
  { key: 'delete', label: 'Can Delete' },
  { key: 'upload', label: 'Can Upload' },
  { key: 'createEreader', label: 'Can Create Ereader' },
  { key: 'accessExplicitContent', label: 'Can Access Explicit Content' },
  { key: 'accessAllLibraries', label: 'Can Access All Libraries' },
  { key: 'accessAllTags', label: 'Can Access All Tags' },
]

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <div className="field-row">
      <div className="fr-meta">
        <div className="fr-t">{label}</div>
      </div>
      <div
        className={'toggle' + (on ? ' on' : '')}
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
      >
        <i />
      </div>
    </div>
  )
}

function MultiSelect({
  options,
  selected,
  onToggle,
  empty,
}: {
  options: { id: string; label: string }[]
  selected: Set<string>
  onToggle: (id: string) => void
  empty: string
}) {
  if (options.length === 0) {
    return (
      <p className="hint" style={{ margin: '4px 0' }}>
        {empty}
      </p>
    )
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 160, overflowY: 'auto' }}>
      {options.map((o) => {
        const on = selected.has(o.id)
        return (
          <button
            key={o.id}
            type="button"
            className={'pill' + (on ? ' on' : '')}
            onClick={() => onToggle(o.id)}
          >
            {on && <Icon name="check" className="ms" />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export interface BulkPermissionsValues {
  type: ABSUserType
  isActive: boolean
  permissions: ABSUserPermissions
}

interface BulkPermissionsModalProps {
  target: AbsTarget
  users: ABSAdminUser[]
  busy?: boolean
  error?: string | null
  onSubmit: (values: BulkPermissionsValues) => void
  onClose: () => void
}

// Applies ONE full account type + enabled state + permission set to every
// selected user, replacing whatever each user had before.
export function BulkPermissionsModal({
  target,
  users,
  busy,
  error,
  onSubmit,
  onClose,
}: BulkPermissionsModalProps) {
  const { data: libsData } = useQuery({
    queryKey: adminKeys.libraries(target.serverId),
    queryFn: () => getLibrariesAdmin(target),
    staleTime: 5 * 60 * 1000,
  })
  const { data: tagsData } = useQuery({
    queryKey: adminKeys.tagNames(target.serverId),
    queryFn: () => getAllTagNames(target),
    staleTime: 5 * 60 * 1000,
  })

  const [type, setType] = useState<ABSUserType>('user')
  const [isActive, setIsActive] = useState(true)
  const [perms, setPerms] = useState<ABSUserPermissions>(defaultPermissions('user'))

  const rootCount = users.filter((u) => u.type === 'root').length

  const libOptions = useMemo(
    () => (libsData?.libraries ?? []).map((l) => ({ id: l.id, label: l.name })),
    [libsData],
  )
  const tagOptions = useMemo(
    () => (tagsData?.tags ?? []).map((t) => ({ id: t, label: t })),
    [tagsData],
  )
  const libSel = useMemo(() => new Set(perms.librariesAccessible), [perms.librariesAccessible])
  const tagSel = useMemo(() => new Set(perms.itemTagsSelected), [perms.itemTagsSelected])

  const setPerm = (key: keyof ABSUserPermissions, value: boolean) =>
    setPerms((p) => ({ ...p, [key]: value }))
  const toggleLib = (id: string) =>
    setPerms((p) => ({
      ...p,
      librariesAccessible: p.librariesAccessible.includes(id)
        ? p.librariesAccessible.filter((x) => x !== id)
        : [...p.librariesAccessible, id],
    }))
  const toggleTag = (id: string) =>
    setPerms((p) => ({
      ...p,
      itemTagsSelected: p.itemTagsSelected.includes(id)
        ? p.itemTagsSelected.filter((x) => x !== id)
        : [...p.itemTagsSelected, id],
    }))

  return (
    <Modal
      title={`Edit permissions - ${users.length} ${users.length === 1 ? 'user' : 'users'}`}
      onClose={onClose}
      foot={
        <>
          <div style={{ flex: 1 }} />
          <button className="btn-sm btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-sm btn-green"
            disabled={busy}
            onClick={() => onSubmit({ type, isActive, permissions: perms })}
          >
            <Icon name="save" /> {busy ? 'Applying...' : `Apply to ${users.length}`}
          </button>
        </>
      }
    >
      {error && <p className="form-err">{error}</p>}

      <p className="hint" style={{ marginTop: 0 }}>
        The settings below replace the account type, enabled state, and full permission set of
        every selected user: {users.map((u) => u.username).join(', ')}
      </p>
      {rootCount > 0 && (
        <p className="hint" style={{ color: 'var(--primary)' }}>
          Root accounts keep their account type; only their permissions and enabled state are
          updated.
        </p>
      )}

      <div className="field full">
        <label>Account type</label>
        <div className="seg seg-full seg-account-type">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              className={type === t.value ? 'on' : ''}
              onClick={() => {
                setType(t.value)
                setPerms((p) => ({
                  ...defaultPermissions(t.value),
                  librariesAccessible: p.librariesAccessible,
                  itemTagsSelected: p.itemTagsSelected,
                  selectedTagsNotAccessible: p.selectedTagsNotAccessible,
                }))
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <Toggle label="Enabled" on={isActive} onChange={setIsActive} />

      <div className="section-head" style={{ marginTop: 18 }}>
        <Icon name="key" />
        <h2>Permissions</h2>
      </div>

      {PERM_TOGGLES.map((t) => (
        <Toggle
          key={t.key}
          label={t.label}
          on={!!perms[t.key]}
          onChange={(v) => setPerm(t.key, v)}
        />
      ))}

      {!perms.accessAllLibraries && (
        <div className="field full" style={{ marginTop: 14 }}>
          <label>Accessible libraries</label>
          <MultiSelect
            options={libOptions}
            selected={libSel}
            onToggle={toggleLib}
            empty="No libraries found."
          />
        </div>
      )}

      {!perms.accessAllTags && (
        <div className="field full" style={{ marginTop: 14 }}>
          <label>Accessible tags</label>
          <MultiSelect
            options={tagOptions}
            selected={tagSel}
            onToggle={toggleTag}
            empty="No tags in the library yet."
          />
        </div>
      )}
    </Modal>
  )
}
