import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// 5 minutes is a sane default; tweak later
const EXPIRE_AFTER_MS = 5 * 60 * 1000

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const ringEventId = String(searchParams.get('ringEventId') ?? '').trim()

    if (!ringEventId) {
      return NextResponse.json({ ok: false, error: 'ringEventId is required' }, { status: 400 })
    }

    // 1) Load ring event (include created_at so we can expire)
    const { data, error } = await supabase
      .from('ring_events')
      .select('id, unit_id, status, created_at, responded_at, response_type')
      .eq('id', ringEventId)
      .single()

    if (error || !data) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    }

    // 2) Expire if needed (only if not already terminal)
    const isTerminal = data.status === 'answered' || !!data.responded_at
    if (!isTerminal) {
      const createdMs = Date.parse(data.created_at)
      const ageMs = Number.isFinite(createdMs) ? Date.now() - createdMs : 0

      if (ageMs > EXPIRE_AFTER_MS) {
        const nowIso = new Date().toISOString()

        const { data: updated, error: updErr } = await supabase
          .from('ring_events')
          .update({
            status: 'answered',
            responded_at: nowIso,
            response_type: 'expired',
          })
          .eq('id', ringEventId)
          .select('id, unit_id, status, created_at, responded_at, response_type')
          .single()

        if (!updErr && updated) {
          return NextResponse.json({
            ok: true,
            ringEvent: updated,

            // backwards-compatible fields (visitor page uses these)
            ringEventId: updated.id,
            status: updated.status,
            respondedAt: updated.responded_at,
            responseType: updated.response_type,
          })
        }
        // If update fails, just fall through and return original data (don’t crash polling)
      }
    }

    // 3) Normal response
    return NextResponse.json({
      ok: true,
      ringEvent: data,

      // backwards-compatible fields
      ringEventId: data.id,
      status: data.status,
      respondedAt: data.responded_at,
      responseType: data.response_type,
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Unexpected error' },
      { status: 500 }
    )
  }
}
