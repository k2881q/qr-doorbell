import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const ringEventId = String(body?.ringEventId ?? '').trim()

    if (!ringEventId) {
      return NextResponse.json(
        { error: 'ringEventId is required' },
        { status: 400 }
      )
    }

    // Deduplicate: don't log SMS twice for same ring event
    const { data: existing, error: existingErr } = await supabase
      .from('notifications')
      .select('id')
      .eq('ring_event_id', ringEventId)
      .eq('channel', 'sms')
      .limit(1)

    if (!existingErr && existing && existing.length > 0) {
      return NextResponse.json({ ok: true, deduped: true })
    }

    const { error } = await supabase.from('notifications').insert({
      ring_event_id: ringEventId,
      channel: 'sms',
      status: 'queued',
      detail: 'Placeholder: SMS would be sent here'
    })

    if (error) {
      console.error('Failed to log SMS notification:', error)
      return NextResponse.json(
        { error: 'Failed to log SMS notification' },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('POST /api/notify/sms error:', err)
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400 }
    )
  }
}
