// app/api/ring/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildDoorbellPayload, sendPushToSubscriptions } from '@/lib/push'

export const runtime = 'nodejs' // IMPORTANT: web-push requires Node, not Edge.

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  })
}

function json(data: any, status = 200) {
  return NextResponse.json(data, { status })
}

type RingRequestBody = {
  unitId?: string
  contactId?: string | null
  visitorName?: string | null
  visitReason?: string | null
}

// You can tune this without touching code by setting env:
// RING_EXPIRE_SECONDS=120 (or whatever you prefer)
function getRingExpireSeconds() {
  const raw = process.env.RING_EXPIRE_SECONDS
  const n = raw ? Number(raw) : 120
  return Number.isFinite(n) && n > 0 ? n : 120
}

export async function POST(req: Request) {
  const supabase = getSupabaseAdmin()

  let body: RingRequestBody
  try {
    body = (await req.json()) as RingRequestBody
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, 400)
  }

  const unitId = (body.unitId || '').trim()
  const contactId = (body.contactId ?? null)?.toString().trim() || null
  const visitorName = (body.visitorName ?? null)?.toString().trim() || null
  const visitReason = (body.visitReason ?? null)?.toString().trim() || null

  if (!unitId) {
    return json({ ok: false, error: 'Missing unitId' }, 400)
  }

  // 1) Verify unit exists + active, and fetch display_name for notification
  const { data: unit, error: unitErr } = await supabase
    .from('units')
    .select('unit_id, display_name, active')
    .eq('unit_id', unitId)
    .maybeSingle()

  if (unitErr) {
    return json({ ok: false, error: unitErr.message }, 500)
  }
  if (!unit || unit.active === false) {
    return json({ ok: false, error: 'Unit not found or inactive' }, 404)
  }

  const expireSeconds = getRingExpireSeconds()
  const expireBeforeIso = new Date(Date.now() - expireSeconds * 1000).toISOString()

  // 2) Expire stale pending rings (best effort)
  // (This is intentionally "best effort"—we don't want expiry errors to break ringing.)
  try {
    await supabase
      .from('ring_events')
      .update({ status: 'expired' })
      .eq('unit_id', unitId)
      .eq('status', 'pending')
      .lt('created_at', expireBeforeIso)
  } catch {
    // ignore
  }

  // 3) Enforce one active ring per unit
  // If there's already a pending ring newer than expiry window, return it and do not create another.
  const { data: existingActive, error: existingErr } = await supabase
    .from('ring_events')
    .select('id, unit_id, status, created_at, responded_at, response_type, visitor_name, visit_reason')
    .eq('unit_id', unitId)
    .eq('status', 'pending')
    .gte('created_at', expireBeforeIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingErr) {
    return json({ ok: false, error: existingErr.message }, 500)
  }

  if (existingActive) {
    // Ring already active; do not spam. Return the existing event.
    return json({ ok: true, ringEvent: existingActive, alreadyActive: true }, 200)
  }

  // 4) Create ring event
  const insertPayload: any = {
    unit_id: unitId,
    status: 'pending',
    visitor_name: visitorName,
    visit_reason: visitReason,
  }

  // If your ring_events table has contact_id, store it (best effort).
  // If it doesn't, Supabase will error—so we only add it if provided AND insert fails we retry.
  const tryInsert = async (withContactId: boolean) => {
    const payload = { ...insertPayload }
    if (withContactId && contactId) payload.contact_id = contactId
    return supabase
      .from('ring_events')
      .insert(payload)
      .select(
        'id, unit_id, status, created_at, responded_at, response_type, visitor_name, visit_reason'
      )
      .single()
  }

  let ringEvent: any
  {
    const first = await tryInsert(true)
    if (!first.error) {
      ringEvent = first.data
    } else {
      // Retry without contact_id in case the column doesn't exist
      const second = await tryInsert(false)
      if (second.error) {
        return json({ ok: false, error: second.error.message }, 500)
      }
      ringEvent = second.data
    }
  }

  // 5) Send push (best effort; NEVER break ring creation)
  // Fetch subscriptions for the unit. If contactId is provided, we *try* to filter by contact_id,
  // but fall back gracefully if that column doesn't exist.
  try {
    // Attempt 1: query includes contact_id
    let subQuery = supabase
      .from('push_subscriptions')
      .select('id, subscription, endpoint, p256dh, auth, contact_id')
      .eq('unit_id', unitId)

    if (contactId) {
      subQuery = subQuery.eq('contact_id', contactId)
    }

    let { data: subRows, error: subErr } = await subQuery

    // If that failed (often because contact_id doesn't exist), retry without contact_id usage.
    if (subErr) {
      const retry = await supabase
        .from('push_subscriptions')
        .select('id, subscription, endpoint, p256dh, auth')
        .eq('unit_id', unitId)

      subRows = retry.data || []
      subErr = retry.error || null
    }

    if (subErr) {
      // Don't break ringing if subscription lookup fails
      console.warn('[ring] push subscription lookup failed:', subErr.message)
    } else if (subRows && subRows.length > 0) {
      const subs = subRows.map((r: any) => {
        const subscription =
          r.subscription ??
          (r.endpoint && r.p256dh && r.auth
            ? { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }
            : null)

        return { id: r.id, subscription }
      }).filter((s: any) => !!s.subscription)

      if (subs.length > 0) {
        const payload = buildDoorbellPayload({
          unitId,
          unitDisplayName: unit.display_name ?? unitId,
          ringEventId: ringEvent.id,
          url: '/receiver',
        })

        await sendPushToSubscriptions(subs, payload, async (deadId: string) => {
          // Dead subscription cleanup
          await supabase.from('push_subscriptions').delete().eq('id', deadId)
        })
      }
    }
  } catch (e: any) {
    console.warn('[ring] push send failed (ignored):', e?.message || e)
  }

  // 6) Return ring event
  return json({ ok: true, ringEvent }, 200)
}
