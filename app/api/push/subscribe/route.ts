import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

type SubscribeBody = {
  unitId: string;
  contactId?: string | null;
  subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };
};

export async function POST(req: Request) {
  try {
    const supabase = getSupabaseAdmin();
    const ua = req.headers.get("user-agent") ?? null;

    const body = (await req.json()) as SubscribeBody;

    const unitId = (body?.unitId ?? "").trim();
    const contactId = body?.contactId ? String(body.contactId) : null;

    const endpoint = body?.subscription?.endpoint;
    const p256dh = body?.subscription?.keys?.p256dh;
    const auth = body?.subscription?.keys?.auth;

    if (!unitId) {
      return NextResponse.json({ ok: false, error: "Missing unitId" }, { status: 400 });
    }
    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json(
        { ok: false, error: "Missing subscription endpoint/keys" },
        { status: 400 }
      );
    }

    // Ensure unit exists
    const { data: unitRow, error: unitErr } = await supabase
      .from("units")
      .select("unit_id")
      .eq("unit_id", unitId)
      .maybeSingle();

    if (unitErr) {
      return NextResponse.json({ ok: false, error: unitErr.message }, { status: 500 });
    }
    if (!unitRow) {
      return NextResponse.json({ ok: false, error: "Unknown unitId" }, { status: 404 });
    }

    // If contactId provided, ensure it belongs to unit
    if (contactId) {
      const { data: cRow, error: cErr } = await supabase
        .from("unit_contacts")
        .select("id, unit_id")
        .eq("id", contactId)
        .maybeSingle();

      if (cErr) {
        return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 });
      }
      if (!cRow || String((cRow as any).unit_id) !== unitId) {
        return NextResponse.json(
          { ok: false, error: "contactId does not belong to unitId" },
          { status: 400 }
        );
      }
    }

    // Upsert by endpoint (matches your UNIQUE endpoint index).
    // If the same device subscribes again for another unit/contact, it will "move" to the new target.
    const { error: upsertErr } = await supabase
      .from("push_subscriptions")
      .upsert(
        {
          unit_id: unitId,
          contact_id: contactId,
          endpoint,
          p256dh,
          auth,
          user_agent: ua,
        },
        { onConflict: "endpoint" }
      );

    if (upsertErr) {
      return NextResponse.json({ ok: false, error: upsertErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
