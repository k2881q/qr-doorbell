import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

function normalizeText(v: unknown, maxLen: number) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, maxLen);
}

export async function POST(req: Request) {
  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json().catch(() => ({}));

    const unitId = normalizeText(body.unitId, 64);
    const contactId = normalizeText(body.contactId, 80); // optional (uuid string)

    const sub = body.subscription;

    const endpoint = normalizeText(sub?.endpoint, 2000);
    const p256dh = normalizeText(sub?.keys?.p256dh, 512);
    const auth = normalizeText(sub?.keys?.auth, 512);

    if (!unitId) {
      return NextResponse.json({ ok: false, error: "Missing unitId" }, { status: 400 });
    }

    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json(
        { ok: false, error: "Missing subscription.endpoint or subscription.keys (p256dh/auth)" },
        { status: 400 }
      );
    }

    // Store both the raw subscription JSON and the extracted fields,
    // because your DB schema has separate NOT NULL columns.
    const payload: any = {
      unit_id: unitId,
      endpoint,
      p256dh,
      auth,
      subscription: sub,
      updated_at: new Date().toISOString(),
    };

    // Optional: store a targeted contact id if you support contact-level push later
    if (contactId) payload.contact_id = contactId;

    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(payload, { onConflict: "endpoint" });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.mess
