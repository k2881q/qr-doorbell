'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'

import type { RingEventStatus, ResponseType } from '@/lib/ringTypes'
import { isTerminalStatus } from '@/lib/ringTypes'


type StatusResponse = {
  ok: boolean
  ringEvent?: {
    id: string
    unit_id: string
    status: RingEventStatus
    created_at: string
    responded_at: string | null
    response_type: ResponseType
  }
  error?: string
}

export default function ReceiverRespondPage() {
  const params = useParams<{ ringEventId: string }>()
  const ringEventId = useMemo(() => params?.ringEventId ?? '', [params])

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState<null | 'answered' | 'declined' | 'busy'>(null)
  const [err, setErr] = useState<string | null>(null)
  const [data, setData] = useState<StatusResponse['ringEvent'] | null>(null)

const isTerminal = isTerminalStatus

  const fetchStatus = useCallback(async () => {
    if (!ringEventId) return
    setErr(null)

    try {
      const res = await fetch(
        `/api/ring/status?ringEventId=${encodeURIComponent(ringEventId)}`,
        { cache: 'no-store' }
      )

      const json = (await res.json()) as StatusResponse
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `Status failed (${res.status})`)
      }

      setData(json.ringEvent ?? null)
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to load status')
    } finally {
      setLoading(false)
    }
  }, [ringEventId])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // Poll only while active
  useEffect(() => {
    if (!data?.status || isTerminal(data.status)) return

    const t = setInterval(fetchStatus, 1500)
    return () => clearInterval(t)
  }, [data?.status, fetchStatus])

  const respond = useCallback(
    async (responseType: 'answered' | 'declined' | 'busy') => {
      if (!ringEventId) return

      setSubmitting(responseType)
      setErr(null)

      try {
        const res = await fetch('/api/ring/respond', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ringEventId, responseType }),
        })

        const json = await res.json()
        if (!res.ok || !json.ok) {
          throw new Error(json.error || `Respond failed (${res.status})`)
        }

        await fetchStatus()
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to respond')
      } finally {
        setSubmitting(null)
      }
    },
    [ringEventId, fetchStatus]
  )

  if (loading) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Receiver response</h1>
        <p>Loading…</p>
      </main>
    )
  }

  return (
    <main style={{ padding: 24, maxWidth: 520 }}>
      <h1>Receiver response</h1>

      {err && (
        <div style={{ marginTop: 12, color: 'red' }}>
          {err}
        </div>
      )}

      {!data ? (
        <p>Ring event not found.</p>
      ) : (
        <>
          <p><strong>Status:</strong> {data.status}</p>
          <p><strong>Unit:</strong> {data.unit_id}</p>

          <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={() => respond('answered')}
              disabled={!!submitting || isTerminal(data.status)}
            >
              Answer
            </button>

            <button
              onClick={() => respond('busy')}
              disabled={!!submitting || isTerminal(data.status)}
            >
              Can’t answer
            </button>

            <button
              onClick={() => respond('declined')}
              disabled={!!submitting || isTerminal(data.status)}
            >
              Decline
            </button>
          </div>

          <p style={{ marginTop: 12 }}>
            <strong>Response:</strong> {data.response_type ?? '—'}
          </p>

          {isTerminal(data.status) && (
            <p style={{ marginTop: 12 }}>
              This ring event is finished. Visitor escalation has stopped.
            </p>
          )}
        </>
      )}
    </main>
  )
}
