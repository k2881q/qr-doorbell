'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { isTerminalStatus } from '@/lib/ringTypes'
import type { RingEventStatus } from '@/lib/ringTypes'

type RingStatus =
  | 'idle'
  | 'ringing'
  | 'ringed'
  | 'sms_sent'
  | 'call_prompt'
  | 'answered'
  | 'error'

export default function RingUnitPage() {
  const params = useParams()

  const rawUnitId = (params as any)?.unitId
  const unitId =
    typeof rawUnitId === 'string'
      ? decodeURIComponent(rawUnitId)
      : Array.isArray(rawUnitId)
        ? decodeURIComponent(rawUnitId[0] ?? '')
        : ''

  const [ringEventId, setRingEventId] = useState<string | null>(null)
  const [ownerPhone, setOwnerPhone] = useState<string | null>(null)

  const [status, setStatus] = useState<RingStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Friendly message when receiver responds
  const [responseType, setResponseType] = useState<string | null>(null)

  // NEW: visitor-provided context (optional)
  const [visitorName, setVisitorName] = useState('')
  const [visitReason, setVisitReason] = useState('')

  const smsTimerRef = useRef<number | null>(null)
  const callTimerRef = useRef<number | null>(null)

  const tryBrowserNotify = async (title: string, body?: string) => {
    try {
      if (typeof window === 'undefined') return
      if (!('Notification' in window)) return

      if (Notification.permission !== 'granted') {
        const p = await Notification.requestPermission()
        if (p !== 'granted') return
      }

      new Notification(title, body ? { body } : undefined)
    } catch {
      // ignore
    }
  }

  const clearTimers = () => {
    if (smsTimerRef.current) window.clearTimeout(smsTimerRef.current)
    if (callTimerRef.current) window.clearTimeout(callTimerRef.current)
    smsTimerRef.current = null
    callTimerRef.current = null
  }

  useEffect(() => {
    return () => clearTimers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startEscalationTimers = (activeRingEventId: string) => {
    clearTimers()

    // After 45s: log SMS attempt server-side (real SMS later)
    smsTimerRef.current = window.setTimeout(async () => {
      try {
        await fetch('/api/notify/sms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ringEventId: activeRingEventId }),
        })
      } catch {
        // Don’t break visitor UX if logging fails
      } finally {
        setStatus(prev => (prev === 'ringed' ? 'sms_sent' : prev))
      }
    }, 45_000)

    // After 2m: show visitor prompt “Call owner?”
    callTimerRef.current = window.setTimeout(() => {
      setStatus('call_prompt')
    }, 120_000)
  }

  // Poll status so escalation stops if receiver responds
  useEffect(() => {
if (!ringEventId) return

const isEscalating =
  status === 'ringed' || status === 'sms_sent' || status === 'call_prompt'

if (!isEscalating) return

let stopped = false


    const interval = window.setInterval(async () => {
      if (stopped) return

      try {
        const res = await fetch(
          `/api/ring/status?ringEventId=${encodeURIComponent(ringEventId)}`,
          { cache: 'no-store' }
        )
        if (!res.ok) return

        const data = await res.json()

        if (data?.status && isTerminalStatus(data.status as RingEventStatus)) {
          clearTimers()
          setResponseType(data?.responseType ?? null)
          setStatus('answered')
          stopped = true
          window.clearInterval(interval)
        }
      } catch {
        // ignore
      }
    }, 2000)

    return () => {
      stopped = true
      window.clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringEventId, status])

  const ring = async () => {
    if (!unitId) {
      setError('No unitId in URL (e.g. /ring/f1u4)')
      setStatus('error')
      return
    }

    await tryBrowserNotify('Doorbell', `Ringing unit ${unitId}…`)

    setIsLoading(true)
    setError(null)
    setResponseType(null)
    setStatus('ringing')

    try {
      const res = await fetch('/api/ring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // ✅ THIS is where visitorName + visitReason go
        body: JSON.stringify({
          unitId,
          visitorName: visitorName.trim() || null,
          visitReason: visitReason.trim() || null,
        }),
      })

      const data = await res.json()

      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error ?? 'Failed to ring')
      }

      const newRingEventId: string | undefined = data?.ringEventId
      if (!newRingEventId) throw new Error('Missing ringEventId from /api/ring')

      setRingEventId(newRingEventId)
      setOwnerPhone(data?.ownerPhone ?? null)
      setStatus('ringed')

      startEscalationTimers(newRingEventId)

      await tryBrowserNotify('Doorbell', 'Ring sent to receiver.')
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong')
      setStatus('error')
    } finally {
      setIsLoading(false)
    }
  }

  const reset = () => {
    clearTimers()
    setRingEventId(null)
    setOwnerPhone(null)
    setStatus('idle')
    setResponseType(null)
    setError(null)
    setIsLoading(false)

    // optional: keep inputs, or clear them—your call. I’ll keep them.
    // setVisitorName('')
    // setVisitReason('')
  }

  const ringDisabled =
    isLoading ||
    !unitId ||
    status === 'ringed' ||
    status === 'sms_sent' ||
    status === 'call_prompt' ||
    status === 'answered'

  return (
    <div style={{ padding: 24, maxWidth: 520 }}>
      <h1>Ring unit: {unitId || '(missing)'}</h1>

      {/* NEW: optional visitor info */}
      <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontWeight: 600 }}>Your name (optional)</span>
          <input
            value={visitorName}
            onChange={e => setVisitorName(e.target.value)}
            placeholder="e.g. Manon"
            style={{ padding: 10, border: '1px solid #ccc', borderRadius: 8 }}
            disabled={isLoading || status === 'ringed' || status === 'sms_sent' || status === 'call_prompt'}
          />
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontWeight: 600 }}>Reason for visit (optional)</span>
          <textarea
            value={visitReason}
            onChange={e => setVisitReason(e.target.value)}
            placeholder="e.g. Delivery / here for a meeting / maintenance"
            style={{ padding: 10, border: '1px solid #ccc', borderRadius: 8, minHeight: 70 }}
            disabled={isLoading || status === 'ringed' || status === 'sms_sent' || status === 'call_prompt'}
          />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <button onClick={ring} disabled={ringDisabled}>
          {isLoading ? 'Ringing…' : 'Ring'}
        </button>

        <button onClick={reset} disabled={isLoading}>
          Reset
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <div>
          <strong>Status:</strong> {status}
        </div>

        {ringEventId && (
          <div>
            <strong>Ring Event ID:</strong> {ringEventId}
          </div>
        )}

        {status === 'answered' && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              border: '1px solid #ddd',
              borderRadius: 10,
            }}
          >
            <p style={{ margin: 0 }}>
              <strong>✅ The unit responded.</strong>
            </p>

            {responseType === 'busy' && (
              <p style={{ margin: '8px 0 0' }}>
                They can’t answer right now. Please wait a bit before trying again.
              </p>
            )}

            {responseType === 'declined' && (
              <p style={{ margin: '8px 0 0' }}>
                They declined the doorbell.
              </p>
            )}

            {(!responseType || responseType === 'answered') && (
              <p style={{ margin: '8px 0 0' }}>
                Someone should be coming to you shortly.
              </p>
            )}

            <button style={{ marginTop: 12 }} onClick={reset}>
              Ring again
            </button>
          </div>
        )}

        {(status === 'ringed' || status === 'sms_sent' || status === 'call_prompt') && (
          <div style={{ marginTop: 10 }}>
            <div>✅ Push queued/sent to owner.</div>

            {status === 'sms_sent' || status === 'call_prompt' ? (
              <div>✅ SMS queued/sent to owner (45s reminder).</div>
            ) : (
              <div>⏳ If no response, SMS will queue after 45 seconds.</div>
            )}
          </div>
        )}

       {status === 'call_prompt' && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              border: '1px solid #ccc',
              borderRadius: 8,
            }}
          >
            <div style={{ marginBottom: 8 }}>
              The unit owner isn’t responding to the doorbell notification.
            </div>

            {ownerPhone ? (
              <a
                href={`tel:${ownerPhone}`}
                style={{
                  display: 'inline-block',
                  padding: '10px 12px',
                  border: '1px solid #111',
                  borderRadius: 8,
                }}
              >
                Call the unit owner
              </a>
            ) : (
              <div>(No phone number configured for this unit yet.)</div>
            )}
          </div>
        )}

        {error && (
          <div style={{ marginTop: 8 }}>
            <strong>Error:</strong> {error}
          </div>
        )}
      </div>
    </div>
  )
}
