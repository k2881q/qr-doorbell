// app/api/ring/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushToSubscriptions } from "@/lib/push";

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

    // 2) Anti-spam: Only one active ring per unit. If there is already an active ring, reuse it.
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
      // If existing ring is missing visitor info and this request includes it, gently fill (no overwrite)
      const patch: any = {};
      if (!existing.visitor_name && visitorName) patch.visitor_name = visitorName;
      if (!existing.visit_reason && visitReason) patch.visit_reason = visitReason;

      // If no contact was previously set, and this request includes one, attach it
      if (!existing.contact_id && contactId) {
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

      // NOTE: We do NOT send a push for an existing active ring.
      // Reason: prevents push-spam if visitor spams the ring button.
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

    // 5) Send push notifications (best-effort; ring creation should still succeed even if push fails)
    //    - Targets unit subscriptions
    //    - If you store contact_id in push_subscriptions, we prefer contact-specific subscriptions
    try {
      // Optional: fetch unit display_name for nicer push body
      const { data: unitRow } = await supabase
        .from("units")
        .select("id, display_name")
        .eq("id", unitId)
        .maybeSingle();

      const unitDisplay = unitRow?.display_name ? String(unitRow.display_name) : unitId;

      // Query subscriptions:
      // If contactIdToStore exists, try contact-specific first (if your schema has contact_id column).
      // If that yields nothing (or column doesn't exist), fall back to unit-wide.
      let subs: Array<{ id: string; subscription: any }> = [];

      // Attempt contact-specific fetch (only if contact_id exists in push_subscriptions)
      if (contactIdToStore) {
        const { data: contactSubs, error: contactSubsErr } = await supabase
          .from("push_subscriptions")
          .select("id, subscription")
          .eq("unit_id", unitId)
          .eq("contact_id", contactIdToStore);

        // If the column doesn't exist, Supabase will error; we just ignore and fall back.
        if (!contactSubsErr && Array.isArray(contactSubs) && contactSubs.length > 0) {
          subs = contactSubs as any;
        }
      }

      // Fall back to unit-wide subs
      if (subs.length === 0) {
        const { data: unitSubs, error: unitSubsErr } = await supabase
          .from("push_subscriptions")
          .select("id, subscription")
          .eq("unit_id", unitId);

        if (!unitSubsErr && Array.isArray(unitSubs)) {
          subs = unitSubs as any;
        }
      }

      if (subs.length > 0) {
        await sendPushToSubscriptions(
          subs,
          {
            title: "Doorbell",
            body: contactName
              ? `${visitorName ? visitorName + " is" : "Someone is"} at ${unitDisplay} for ${contactName}.`
              : `${visitorName ? visitorName + " is" : "Someone is"} at ${unitDisplay}.`,
            data: { url: "/receiver", ringEventId: created.id, unitId },
            tag: `ring-${created.id}`,
          },
          async (subId) => {
            // remove invalid subscriptions
            await supabase.from("push_subscriptions").delete().eq("id", subId);
          }
        );
      }
    } catch (pushErr) {
      // Best-effort only; log server-side if you want but do not fail the ring.
      // console.error("[push] failed to send", pushErr);
    }

    return NextResponse.json({ ok: true, ringEvent: created }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
