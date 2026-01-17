import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)

    const unitId = String(searchParams.get('unitId') ?? '').trim()

    // default: show active only in UI; API supports both
    const activeOnlyParam = String(searchParams.get('activeOnly') ?? '').trim().toLowerCase()
    const activeOnly =
      activeOnlyParam === '1' ||
      activeOnlyParam === 'true' ||
      activeOnlyParam === 'yes'

    const limitRaw = String(searchParams.get('limit') ?? '25').trim()
    const limit = Math.min(Math.max(parseInt(limitRaw || '25', 10) || 25, 1), 100)

    let q = supabase
      .from('ring_events')
      .select('id, unit_id, status, created_at, responded_at, response_type, visitor_name, visit_reason')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (unitId) q = q.eq('unit_id', unitId)
    if (activeOnly) q = q.neq('status', 'answered')

    const { data, error } = await q

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      ringEvents: data ?? [],
      activeOnly,
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Unexpected error' },
      { status: 500 }
    )
  }
}
