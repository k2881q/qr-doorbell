import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

  return createClient(url, key, { auth: { persistSession: false } })
}

export async function GET() {
  try {
    const supabase = getSupabaseAdmin()

    // IMPORTANT:
    // We return unit_id (e.g. "1u4") because that's what ring_events & push_subscriptions use,
    // and it's what the receiver dropdown must send back to the server.
    const { data, error } = await supabase
      .from('units')
      .select('unit_id, display_name, active')
      .eq('active', true)
      .order('display_name', { ascending: true })

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, units: data ?? [] }, { status: 200 })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
