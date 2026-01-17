import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type RingStatus = "ringed" | "sms_sent" | "call_prompt" | "answered";

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
    const visitorName = normalizeText(body.visitorName, 80);
    const visitReason = normalizeText(body.visitReason, 200);
    const contactId = normalizeText(body.contactId, 80); // uuid string

    if (!unitId) {
      return NextResponse.json({ ok: false, error: "Missing unitId" }, { status: 400 });
    }

    // 1) Auto-expire stale active rings for this unit (prevents zombies)
    //    (Matches your existing "self-heal" behavior.)
    const { error: expireError } = await supabase
      .from("ring_events")
      .update({
        status: "answered",
        response_type: "expired",
        responded_at: new Date().toISOString(),
      })
      .eq("unit_id", unitId)
      .neq("status", "answered")
      .lt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());

    if (expireError) {
      return NextResponse.json({ ok: false, error: expireError.message }, { status: 500 });
    }

    // 2) Anti-spam: Only one active ring per unit.
    //    If there is already an active ring, reuse it.
    const { data: existing, error: existingError } = await supabase
      .from("ring_events")
      .select(
        "id, unit_id, status, created_at, responded_at, response_type, visitor_name, visit_reason, contact_id, contact_name"
      )
      .eq("unit_id", unitId)
      .neq("status", "answered")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ ok: false, error: existingError.message }, { status: 500 });
    }

    if (existing?.id) {
      // Optionally: if the existing ring is missing visitor info and this request includes it,
      // we can gently fill it in (won't overwrite).
      const patch: any = {};
      if (!existing.visitor_name && visitorName) patch.visitor_name = visitorName;
      if (!existing.visit_reason && visitReason) patch.visit_reason = visitReason;

      // Also: if no contact was previously set, and this request includes one, we can attach it.
      // (Still one ring per unit; we’re just capturing intent.)
      if (!existing.contact_id && contactId) {
        // Look up contact display_name safely (no phone returned).
        const { data: c, error: cErr } = await supabase
          .from("unit_contacts")
          .select("id, display_name, unit_id, active")
          .eq("id", contactId)
          .eq("unit_id", unitId)
          .maybeSingle();

        if (!cErr && c && c.active !== false) {
          patch.contact_id = c.id;
          patch.contact_name = c.display_name;
        }
      }

      if (Object.keys(patch).length > 0) {
        await supabase.from("ring_events").update(patch).eq("id", existing.id);
      }

      return NextResponse.json({ ok: true, ringEvent: existing }, { status: 200 });
    }

    // 3) Determine target contact snapshot (NO phone returned to client)
    let contactName: string | null = null;
    let contactIdToStore: string | null = null;

    if (contactId) {
      const { data: c, error: cErr } = await supabase
        .from("unit_contacts")
        .select("id, display_name, unit_id, active")
        .eq("id", contactId)
        .eq("unit_id", unitId)
        .maybeSingle();

      if (cErr) {
        return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 });
      }

      if (!c || c.active === false) {
        return NextResponse.json(
          { ok: false, error: "Selected contact not found or inactive for this unit." },
          { status: 400 }
        );
      }

      contactIdToStore = String(c.id);
      contactName = String(c.display_name);
    }

    // 4) Create new ring event
    const insertPayload: any = {
      unit_id: unitId,
      status: "ringed" satisfies RingStatus,
      visitor_name: visitorName,
      visit_reason: visitReason,
      // requires you to have added these columns to ring_events:
      contact_id: contactIdToStore,
      contact_name: contactName,
    };

    const { data: created, error: createError } = await supabase
      .from("ring_events")
      .insert(insertPayload)
      .select(
        "id, unit_id, status, created_at, responded_at, response_type, visitor_name, visit_reason, contact_id, contact_name"
      )
      .single();

    if (createError) {
      return NextResponse.json({ ok: false, error: createError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, ringEvent: created }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
