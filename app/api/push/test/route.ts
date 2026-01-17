import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPushToSubscriptions } from '@/lib/push'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { subscriptionId } = body as { subscriptionId?: string }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ ok: false, error: 'Missing Supabase env vars' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  const q = supabase.from('push_subscriptions').select('id, subscription')
  const { data, error } = subscriptionId ? await q.eq('id', subscriptionId).limit(1) : await q.limit(5)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const subs = (data || []) as any[]

  const results = await sendPushToSubscriptions(
    subs,
    {
      title: 'Doorbell test',
      body: 'If you see this, push sending works 🎉',
      data: { url: '/receiver' },
    },
    async (id) => {
      await supabase.from('push_subscriptions').delete().eq('id', id)
    }
  )

  return NextResponse.json({ ok: true, count: subs.length, results })
}
