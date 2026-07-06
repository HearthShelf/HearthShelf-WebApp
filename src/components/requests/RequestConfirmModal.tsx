import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '@/components/common/Modal'
import { Icon } from '@/components/common/Icon'
import { useSubmitRequest } from '@/hooks/useRmab'
import { audibleStoreUrl } from '@/api/absAudible'
import type { AbsTarget } from '@/api/absLibrary'
import type { RmabRequest } from '@/api/absRequests'
import type { HSAudibleSearchResult } from '@hearthshelf/core'

interface RequestConfirmModalProps {
  // Kept for call-site symmetry; the submit hook is bound to the active server.
  target: AbsTarget
  // A catalog result (plain search hit or a series book, which extends it).
  book: HSAudibleSearchResult
  // Whether the request backend can fulfill this book. Gates the Request action.
  canRequest: boolean
  onClose: () => void
}

// An awaiting-approval request still needs an admin before it downloads; every
// other returned status means it's already queued.
function isAwaitingApproval(req?: RmabRequest): boolean {
  return req?.status === 'awaiting_approval'
}

const ERROR_COPY: Record<string, string> = {
  AlreadyAvailable: 'That title is already in your library.',
  BeingProcessed: 'That title is already being processed.',
  DuplicateRequest: "You've already requested that title.",
  Ignored: 'That title is on your ignore list.',
  UserNotFound: "Couldn't find the requesting account on ReadMeABook.",
}

// The book cover + title/author header, shared across every phase.
function BookHead({ book, note }: { book: HSAudibleSearchResult; note?: string }) {
  return (
    <div className="rc-top">
      {book.coverArtUrl ? (
        <img className="cover" src={book.coverArtUrl} alt="" />
      ) : (
        <div className="cover" style={{ background: 'var(--c-highest)' }} />
      )}
      <div style={{ minWidth: 0 }}>
        <h2 className="rc-h">{book.title}</h2>
        <div className="rc-sub">{book.author}</div>
        {book.narrator && (
          <div className="rc-sub" style={{ marginTop: 2 }}>
            Narrated by {book.narrator}
          </div>
        )}
        {note && (
          <div className="rmab-via" style={{ marginTop: 10 }}>
            <Icon name="bolt" fill /> {note}
          </div>
        )}
      </div>
    </div>
  )
}

// Opens on a "you don't own this book" step with Close / Open Audible / Request
// (Request only when the backend is connected). Requesting advances to the
// confirm step, then to a success/awaiting result - all in one modal.
export function RequestConfirmModal({ book, canRequest, onClose }: RequestConfirmModalProps) {
  const navigate = useNavigate()
  const submit = useSubmitRequest()
  const [phase, setPhase] = useState<'intro' | 'confirm'>('intro')
  const [result, setResult] = useState<RmabRequest | null>(null)
  const [error, setError] = useState<string | null>(null)

  const confirm = () => {
    setError(null)
    submit.mutate(
      {
        asin: book.asin,
        title: book.title,
        author: book.author,
        narrator: book.narrator,
        description: book.description,
        coverArtUrl: book.coverArtUrl,
      },
      {
        onSuccess: (res) => {
          if (res.success && res.request) setResult(res.request)
          else setError(ERROR_COPY[res.error ?? ''] ?? 'Request failed. Please try again.')
        },
        onError: () => setError("Couldn't reach ReadMeABook. Please try again."),
      },
    )
  }

  const approved = !isAwaitingApproval(result ?? undefined)
  const audibleBtn = (
    <a
      className="req-btn ghost"
      href={audibleStoreUrl(book)}
      target="_blank"
      rel="noopener noreferrer"
    >
      <Icon name="open_in_new" /> Open Audible
    </a>
  )

  // Result phase: request submitted.
  if (result) {
    return (
      <Modal
        title={approved ? 'Requested' : 'Waiting for approval'}
        onClose={onClose}
        foot={
          <>
            <button className="req-btn ghost" onClick={onClose}>
              Done
            </button>
            <button
              className="req-btn"
              onClick={() => {
                onClose()
                navigate('/requests')
              }}
            >
              <Icon name="receipt_long" /> View requests
            </button>
          </>
        }
      >
        <div className="rc-success">
          <div
            className="ok"
            style={{
              background: `color-mix(in oklab, ${approved ? '#5a9c52' : '#d9a45a'} 20%, transparent)`,
              color: approved ? '#5a9c52' : '#d9a45a',
            }}
          >
            <Icon name={approved ? 'cloud_download' : 'schedule'} fill />
          </div>
          <h3>{approved ? 'Requested' : 'Waiting for approval'}</h3>
          <p>
            {approved
              ? `We'll add ${book.title} to your library when it's ready.`
              : `Your request for ${book.title} was sent - an admin needs to approve it before it downloads.`}
          </p>
        </div>
      </Modal>
    )
  }

  // Confirm phase: reached only via Request.
  if (phase === 'confirm') {
    return (
      <Modal
        title="Request audiobook"
        onClose={onClose}
        foot={
          <>
            <button
              className="req-btn ghost"
              onClick={() => setPhase('intro')}
              disabled={submit.isPending}
            >
              Back
            </button>
            <button className="req-btn" onClick={confirm} disabled={submit.isPending}>
              <Icon name="add" /> {submit.isPending ? 'Requesting...' : 'Request'}
            </button>
          </>
        }
      >
        <BookHead book={book} note="via ReadMeABook" />
        <p className="rc-note">
          ReadMeABook will search for it, download it, and add it to your HearthShelf library
          automatically. You'll see live status under Requests.
        </p>
        {error && (
          <div className="rr-err" style={{ marginTop: 12 }}>
            <Icon name="error" fill /> {error}
          </div>
        )}
      </Modal>
    )
  }

  // Intro phase: "you don't own this book".
  return (
    <Modal
      title="You don't own this book"
      onClose={onClose}
      foot={
        <>
          <button className="req-btn ghost" onClick={onClose}>
            Close
          </button>
          {audibleBtn}
          {canRequest && (
            <button className="req-btn" onClick={() => setPhase('confirm')}>
              <Icon name="bolt" fill /> Request
            </button>
          )}
        </>
      }
    >
      <BookHead book={book} />
      <p className="rc-note">
        {book.title} isn't in your library yet.
        {canRequest
          ? ' Request it through ReadMeABook, or open it on Audible.'
          : ' You can open it on Audible.'}
      </p>
    </Modal>
  )
}
