import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs"; // keep Node runtime for compatibility

type PublicContact = {
  id: string;
  name: string;
};

type PublicUnit = {
  unitId: string;
  studioNumber: string; // NOW: display_name (fallback to unit_id)
  companyName: string | null;
  contacts: PublicContact[];
};

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

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    // Fetch units (public-safe fields only)
    // Option 1: use units.display_name as the human-facing studio label.
    const { data: unitsData, error: unitsError } = await supabase
      .from("units")
      .select("unit_id, display_name, company_name, active, sort_order")
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("unit_id", { ascending: true });

    if (unitsError) {
      return NextResponse.json(
        { ok: false, error: unitsError.message },
        { status: 500 }
      );
    }

    const activeUnits = (unitsData ?? []).filter((u: any) => u?.active !== false);
    const unitIds = activeUnits.map((u: any) => String(u.unit_id));

    // Fetch contacts for those units (public-safe fields only; NEVER return phone)
    const { data: contactsData, error: contactsError } = await supabase
      .from("unit_contacts")
      .select("id, unit_id, display_name, active, sort_order")
      .in("unit_id", unitIds)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("display_name", { ascending: true });

    if (contactsError) {
      return NextResponse.json(
        { ok: false, error: contactsError.message },
        { status: 500 }
      );
    }

    // Group contacts by unit_id
    const contactsByUnit = new Map<string, PublicContact[]>();
    for (const c of contactsData ?? []) {
      if ((c as any)?.active === false) continue;

      const unitId = String((c as any).unit_id);
      const list = contactsByUnit.get(unitId) ?? [];

      list.push({
        id: String((c as any).id),
        name: String((c as any).display_name),
      });

      contactsByUnit.set(unitId, list);
    }

    const units: PublicUnit[] = activeUnits.map((u: any) => {
      const unitId = String(u.unit_id);

      // studioNumber uses display_name when present; falls back to unit_id.
      const studioNumber =
        (typeof u.display_name === "string" && u.display_name.trim()
          ? u.display_name.trim()
          : unitId);

      return {
        unitId,
        studioNumber,
        companyName: u.company_name ?? null,
        contacts: contactsByUnit.get(unitId) ?? [],
      };
    });

    return NextResponse.json({ ok: true, units }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
