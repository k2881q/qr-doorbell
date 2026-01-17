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
    const responseType = String(body?.responseType ?? 'answered').trim()

    if (!ringEventId) {
      return NextResponse.json({ error: 'ringEventId is required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('ring_events')
      .update({
        responded_at: new Date().toISOString(),
        response_type: responseType,
        status: 'answered'
      })
      .eq('id', ringEventId)
      .select()
      .single()

    if (error) {
      console.error(error)
      return NextResponse.json({ error: 'Failed to update ring event', supabaseError: error }, { status: 500 })
    }

    return NextResponse.json({ ok: true, ringEvent: data })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
