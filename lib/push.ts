import webpush from 'web-push'

export type DBPushSubscription = {
  id: string

  // If you stored the full subscription JSON in one column:
  subscription?: any | null

  // If you stored split fields instead (your table has these):
  endpoint?: string | null
  p256dh?: string | null
  auth?: string | null
}

function getVapid() {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY

  if (!publicKey || !privateKey) {
    throw new Error('Missing VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY')
  }
  return { publicKey, privateKey }
}

export function configureWebPush() {
  const { publicKey, privateKey } = getVapid()
  webpush.setVapidDetails('mailto:admin@example.com', publicKey, privateKey)
}

/**
 * Builds the exact payload your service worker expects:
 * { title, body, url }
 *
 * Visual urgency:
 * - title is always "🔔 Doorbell"
 * - body is short and actionable
 * - url defaults to "/receiver"
 */
export function buildDoorbellPayload(args: {
  unitDisplayName?: string | null
  visitorName?: string | null
  visitReason?: string | null
  url?: string | null
}) {
  const unitLabel = (args.unitDisplayName || '').trim() || 'Your unit'
  const who = (args.visitorName || '').trim()
  const why = (args.visitReason || '').trim()

  // Keep body short, punchy, actionable.
  let body = `${unitLabel} is ringing — tap to respond`
  if (who && why) body = `${who} (${why}) — tap to respond`
  else if (who) body = `${who} is at the door — tap to respond`
  else if (why) body = `${why} — tap to respond`

  return {
    title: '🔔 Doorbell',
    body,
    url: (args.url || '').trim() || '/receiver',
  }
}

function normalizePayload(payload: any): string {
  // Allow callers to pass either a string or object
  if (typeof payload === 'string') return payload
  return JSON.stringify(payload)
}

function toWebPushSubscription(row: DBPushSubscription): any {
  // Prefer the full JSON subscription if present
  if (row.subscription && row.subscription.endpoint) return row.subscription

  // Otherwise build it from split columns
  if (row.endpoint && row.p256dh && row.auth) {
    return {
      endpoint: row.endpoint,
      keys: {
        p256dh: row.p256dh,
        auth: row.auth,
      },
    }
  }

  throw new Error(`Subscription row ${row.id} missing endpoint/keys`)
}

export async function sendPushToSubscriptions(
  subs: DBPushSubscription[],
  payload: any,
  onGone?: (id: string) => Promise<void>
) {
  configureWebPush()

  const body = normalizePayload(payload)

  const results = await Promise.allSettled(
    subs.map(async (row) => {
      try {
        const sub = toWebPushSubscription(row)
        await webpush.sendNotification(sub, body)
        return { ok: true, id: row.id }
      } catch (err: any) {
        // web-push puts statusCode on the error object
        const statusCode = err?.statusCode
        if (statusCode === 410 || statusCode === 404) {
          if (onGone) await onGone(row.id)
        }
        return { ok: false, id: row.id, statusCode, message: String(err?.message || err) }
      }
    })
  )

  return results
}
