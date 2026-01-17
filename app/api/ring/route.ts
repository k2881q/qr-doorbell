import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Prevent spam: if a ring was created in the last N seconds, reuse it
const COOLDOWN_MS = 20 * 1000

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const unitId = String(body?.unitId ?? '').trim()
    const visitorId = body?.visitorId ?? null

    const visitorNameRaw = String(body?.visitorName ?? '').trim()
    const visitReasonRaw = String(body?.visitReason ?? '').trim()
    const visitorName = visitorNameRaw.length ? visitorNameRaw : null
    const visitReason = visitReasonRaw.length ? visitReasonRaw : null

    if (!unitId) {
      return NextResponse.json({ ok: false, error: 'unitId is required' }, { status: 400 })
    }

    // 1) Look up unit → owner phone
    const { data: unitRow, error: unitErr } = await supabase
      .from('units')
      .select('unit_id, owner_phone')
      .eq('unit_id', unitId)
      .single()

    if (unitErr || !unitRow) {
      return NextResponse.json({ ok: false, error: `Unknown unitId: ${unitId}` }, { status: 404 })
    }

    // 2) Check for an existing active ring (prevents multiple simultaneous rings per unit)
    const { data: active, error: activeErr } = await supabase
      .from('ring_events')
      .select('id, unit_id, status, created_at, responded_at, response_type, visitor_name, visit_reason')
      .eq('unit_id', unitId)
      .neq('status', 'answered')
      .order('created_at', { ascending: false })
      .limit(1)

    if (!activeErr && active && active.length > 0) {
      const existing = active[0]

      // Optional: if within cooldown window, definitely reuse
      const createdMs = Date.parse(existing.created_at)
      const ageMs = Number.isFinite(createdMs) ? Date.now() - createdMs : COOLDOWN_MS + 1
      const withinCooldown = ageMs <= COOLDOWN_MS

      // Either way, reusing an active ring is the simplest and safest anti-spam behavior.
      // (If you ever want to allow multiple active rings per unit, we'd revisit this.)
      return NextResponse.json({
        ok: true,
        reused: true,
        ringEventId: existing.id,
        status: existing.status,
        createdAt: existing.created_at,
        ownerPhone: unitRow.owner_phone,
        visitorName: existing.visitor_name ?? null,
        visitReason: existing.visit_reason ?? null,
        withinCooldown,
      })
    }

    // 3) Create a new ring event
    const { data: ringEvent, error: ringErr } = await supabase
      .from('ring_events')
      .insert({
        unit_id: unitId,
        visitor_id: visitorId,
        status: 'ringed',
        visitor_name: visitorName,
        visit_reason: visitReason,
      })
      .select('id, unit_id, status, created_at, visitor_name, visit_reason')
      .single()

    if (ringErr || !ringEvent) {
      console.error('Ring insert error:', ringErr)
      return NextResponse.json({ ok: false, error: 'Failed to create ring event' }, { status: 500 })
    }

    // 4) Log push notification (placeholder)
    await supabase.from('notifications').insert({
      ring_event_id: ringEvent.id,
      channel: 'push',
      status: 'queued',
      detail: 'Placeholder: push would be sent here',
    })

    // 5) Return payload to visitor UI
    return NextResponse.json({
      ok: true,
      reused: false,
      ringEventId: ringEvent.id,
      status: ringEvent.status,
      createdAt: ringEvent.created_at,
      ownerPhone: unitRow.owner_phone,
      visitorName: ringEvent.visitor_name ?? null,
      visitReason: ringEvent.visit_reason ?? null,
    })
  } catch (err) {
    console.error('POST /api/ring error:', err)
    return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 })
  }
}
