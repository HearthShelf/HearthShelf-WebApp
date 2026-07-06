import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getLibrariesAdmin, getAllTagNames, adminKeys } from '@/api/absAdmin'
import type { ABSAdminUser, ABSUserPermissions, ABSUserType } from '@/api/absAdmin'
import type { AbsTarget } from '@/api/absLibrary'
import { Icon } from '@/components/common/Icon'
import { Modal } from '@/components/common/Modal'

const TYPES: { value: ABSUserType; label: string }[] = [
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
  { value: 'guest', label: 'Guest' },
]

// The permission toggles we surface, in display order. librariesAccessible /
// itemTagsSelected are handled separately by the pickers below.
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

export function defaultPermissions(type: ABSUserType): ABSUserPermissions {
  const elevated = type === 'admin'
  return {
    download: true,
    update: elevated,
    delete: false,
    upload: elevated,
    createEreader: elevated,
    accessAllLibraries: true,
    accessAllTags: true,
    accessExplicitContent: elevated,
    selectedTagsNotAccessible: false,
    librariesAccessible: [],
    itemTagsSelected: [],
  }
}

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

// Simple checkbox-list multi-select for libraries / tags.
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
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        maxHeight: 160,
        overflowY: 'auto',
      }}
    >
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

export interface EditPermissionsValues {
  type: ABSUserType
  isActive: boolean
  permissions: ABSUserPermissions
}

interface EditPermissionsModalProps {
  target: AbsTarget
  user: ABSAdminUser
  busy?: boolean
  error?: string | null
  onSubmit: (values: EditPermissionsValues) => void
  onClose: () => void
}

export function EditPermissionsModal({
  target,
  user,
  busy,
  error,
  onSubmit,
  onClose,
}: EditPermissionsModalProps) {
  const isRoot = user.type === 'root'

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

  const [type, setType] = useState<ABSUserType>((user.type as ABSUserType) ?? 'user')
  const [isActive, setIsActive] = useState(user.isActive)
  const [perms, setPerms] = useState<ABSUserPermissions>(
    user.permissions ?? defaultPermissions('user'),
  )

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

  const submit = () => {
    onSubmit({ type, isActive, permissions: perms })
  }

  return (
    <Modal
      title={`Edit permissions - ${user.username}`}
      onClose={onClose}
      foot={
        <>
          <div style={{ flex: 1 }} />
          <button className="btn-sm btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-sm btn-green" disabled={busy} onClick={submit}>
            <Icon name="save" /> Save changes
          </button>
        </>
      }
    >
      {error && <p className="form-err">{error}</p>}
      {isRoot && (
        <p className="hint" style={{ marginTop: 0, color: 'var(--text-muted)' }}>
          This is a root account. Account type is locked.
        </p>
      )}

      <div className="field full">
        <label>Account type</label>
        <div className="seg seg-full seg-account-type">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              disabled={isRoot}
              className={type === t.value ? 'on' : ''}
              onClick={() => {
                setType(t.value)
                // Re-seed permission defaults to the new type's baseline, but keep
                // any library/tag selections the admin already made.
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
