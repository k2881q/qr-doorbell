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
    const subscription = body.subscription;

    if (!unitId) {
      return NextResponse.json({ ok: false, error: "Missing unitId" }, { status: 400 });
    }

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return NextResponse.json(
        { ok: false, error: "Missing or invalid subscription payload" },
        { status: 400 }
      );
    }

    // IMPORTANT: We no longer hard-fail if unitId isn't in the units table.
    // Some setups use string IDs (f1u4) while the units table might be uuid-based,
    // and we don't want push to be blocked by that.
    // If you want to re-enable strict validation later, do it once your units table is finalized.

    // Upsert by endpoint (unique). If your table uses a different unique constraint,
    // adjust accordingly.
    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(
        {
          unit_id: unitId,
          subscription,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" }
      );

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
