import webpush from 'web-push'

type DBPushSubscription = {
  id: string
  subscription: any
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

export async function sendPushToSubscriptions(
  subs: DBPushSubscription[],
  payload: any,
  onGone?: (id: string) => Promise<void>
) {
  configureWebPush()

  const results = await Promise.allSettled(
    subs.map(async (row) => {
      try {
        await webpush.sendNotification(row.subscription, JSON.stringify(payload))
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
