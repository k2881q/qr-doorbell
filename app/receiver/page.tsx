'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'

type RingEvent = {
  id: string
  unit_id: string
  status: string
  created_at: string
  responded_at: string | null
  response_type: string | null
  visitor_name?: string | null
  visit_reason?: string | null
}

type RecentResponse = {
  ok: boolean
  error?: string
  ringEvents?: RingEvent[]
  activeOnly?: boolean
}

export default function ReceiverInboxPage() {
  const [unitFilter, setUnitFilter] = useState<string>('') // optional filter
  const [showHistory, setShowHistory] = useState<boolean>(false) // default active-only
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [events, setEvents] = useState<RingEvent[]>([])
  const [submitting, setSubmitting] = useState<Record<string, string | null>>({})

  // New-ring alert state
  const [newRingBanner, setNewRingBanner] = useState<string | null>(null)
  const prevTopIdRef = useRef<string | null>(null)
  const bannerTimerRef = useRef<number | null>(null)
  const titleTimerRef = useRef<number | null>(null)

  const isTerminal = useCallback((ev: RingEvent) => {
    // Your DB treats status='answered' as terminal
    return ev.status === 'answered' || !!ev.responded_at
  }, [])

  const qs = useMemo(() => {
    const sp = new URLSearchParams()
    if (unitFilter.trim()) sp.set('unitId', unitFilter.trim())
    sp.set('limit', '25')
    sp.set('activeOnly', showHistory ? 'false' : 'true')
    return sp.toString()
  }, [unitFilter, showHistory])

  const stopBannerTimers = () => {
    if (bannerTimerRef.current) window.clearTimeout(bannerTimerRef.current)
    if (titleTimerRef.current) window.clearTimeout(titleTimerRef.current)
    bannerTimerRef.current = null
    titleTimerRef.current = null
  }

  const beep = () => {
    // Best-effort: browser may block audio without user gesture; that's fine.
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!AudioCtx) return
      const ctx = new AudioCtx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.value = 0.05
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.12)
      osc.onended = () => {
        try { ctx.close() } catch {}
      }
    } catch {
      // ignore
    }
  }

  const flashTitle = (msg: string, ms = 4000) => {
    try {
      const original = document.title
      document.title = msg
      if (titleTimerRef.current) window.clearTimeout(titleTimerRef.current)
      titleTimerRef.current = window.setTimeout(() => {
        document.title = original
        titleTimerRef.current = null
      }, ms)
    } catch {
      // ignore
    }
  }

  const fetchRecent = useCallback(async () => {
    setErr(null)
    try {
      const res = await fetch(`/api/ring/recent?${qs}`, { cache: 'no-store' })
      const json = (await res.json()) as RecentResponse

      if (!res.ok || !json.ok) {
        throw new Error(json.error || `Failed (${res.status})`)
      }

      const list = json.ringEvents ?? []
      setEvents(list)

      // Detect new ring at top (only when viewing active rings, not history)
      if (!showHistory && list.length > 0) {
        const top = list[0]
        const prevTop = prevTopIdRef.current

        if (prevTop && top.id !== prevTop) {
          // New ring arrived
          stopBannerTimers()
          setNewRingBanner(`🔔 New ring: unit ${top.unit_id}`)
          flashTitle('🔔 Doorbell!')
          beep()

          bannerTimerRef.current = window.setTimeout(() => {
            setNewRingBanner(null)
            bannerTimerRef.current = null
          }, 6000)
        }

        prevTopIdRef.current = top.id
      } else if (list.length === 0) {
        prevTopIdRef.current = null
      }
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to load inbox')
    } finally {
      setLoading(false)
    }
  }, [qs, showHistory])

  useEffect(() => {
    fetchRecent()
  }, [fetchRecent])

  // Poll
  useEffect(() => {
    const t = setInterval(fetchRecent, 1500)
    return () => clearInterval(t)
  }, [fetchRecent])

  // Cleanup timers on unmount
  useEffect(() => {
    return () => stopBannerTimers()
  }, [])

  const respond = useCallback(
    async (ringEventId: string, responseType: 'answered' | 'busy' | 'declined') => {
      setSubmitting(prev => ({ ...prev, [ringEventId]: responseType }))
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

        await fetchRecent()
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to respond')
      } finally {
        setSubmitting(prev => ({ ...prev, [ringEventId]: null }))
      }
    },
    [fetchRecent]
  )

  return (
    <main style={{ padding: 24, maxWidth: 900 }}>
      <h1>Receiver inbox</h1>

      <div style={{ marginTop: 12, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontWeight: 600 }}>Filter unit:</span>
          <input
            value={unitFilter}
            onChange={e => setUnitFilter(e.target.value)}
            placeholder="e.g. f1u4 (leave empty = all)"
            style={{ padding: 8, width: 240 }}
          />
        </label>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={showHistory}
            onChange={e => setShowHistory(e.target.checked)}
          />
          <span>Show history</span>
        </label>

        <button onClick={fetchRecent} style={{ padding: '8px 12px' }}>
          Refresh
        </button>
      </div>

      {newRingBanner && (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            border: '1px solid #ccc',
            borderRadius: 10,
            background: '#f7f7f7',
          }}
        >
          <strong>{newRingBanner}</strong>
        </div>
      )}

      {err && (
        <div style={{ marginTop: 12, color: 'red' }}>
          {err}
        </div>
      )}

      {loading ? (
        <p style={{ marginTop: 16 }}>Loading…</p>
      ) : events.length === 0 ? (
        <p style={{ marginTop: 16 }}>
          {showHistory ? 'No ring events yet.' : 'No active rings right now.'}
        </p>
      ) : (
        <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
          {events.map(ev => {
            const terminal = isTerminal(ev)
            const busy = !!submitting[ev.id]

            return (
              <div
                key={ev.id}
                style={{
                  border: '1px solid #ddd',
                  borderRadius: 10,
                  padding: 12,
                  display: 'grid',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>
                      Unit: {ev.unit_id}
                    </div>

                    <div style={{ opacity: 0.85, marginTop: 4 }}>
                      Status: <strong>{ev.status}</strong>
                      {ev.response_type ? <> · Response: <strong>{ev.response_type}</strong></> : null}
                    </div>

                    {(ev.visitor_name || ev.visit_reason) && (
                      <div style={{ marginTop: 6, opacity: 0.85 }}>
                        {ev.visitor_name ? (
                          <div><strong>Visitor:</strong> {ev.visitor_name}</div>
                        ) : null}
                        {ev.visit_reason ? (
                          <div><strong>Reason:</strong> {ev.visit_reason}</div>
                        ) : null}
                      </div>
                    )}

                    <div style={{ opacity: 0.7, fontSize: 12, marginTop: 6 }}>
                      Created: {new Date(ev.created_at).toLocaleString()}
                      {ev.responded_at ? <> · Responded: {new Date(ev.responded_at).toLocaleString()}</> : null}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <Link href={`/receiver/respond/${encodeURIComponent(ev.id)}`}>
                      Open detail
                    </Link>
                    <div style={{ opacity: 0.6, fontSize: 12, marginTop: 4 }}>
                      {ev.id}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => respond(ev.id, 'answered')}
                    disabled={terminal || busy}
                    style={{ padding: '8px 12px' }}
                  >
                    Answer
                  </button>

                  <button
                    onClick={() => respond(ev.id, 'busy')}
                    disabled={terminal || busy}
                    style={{ padding: '8px 12px' }}
                  >
                    Can’t answer
                  </button>

                  <button
                    onClick={() => respond(ev.id, 'declined')}
                    disabled={terminal || busy}
                    style={{ padding: '8px 12px' }}
                  >
                    Decline
                  </button>

                  {terminal && (
                    <span style={{ alignSelf: 'center', opacity: 0.75 }}>
                      ✅ Completed
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}
