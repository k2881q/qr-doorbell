"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type PublicContact = {
  id: string;
  name: string;
};

type PublicUnit = {
  unitId: string;
  studioNumber: string;
  companyName: string | null;
  contacts: PublicContact[];
};

export default function RingIndexPage() {
  const router = useRouter();

  const [units, setUnits] = useState<PublicUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setErr(null);

        const res = await fetch("/api/units/public");
        const body = await res.json().catch(() => null);

        if (!res.ok || !body?.ok) {
          throw new Error(body?.error || `Failed to load units (HTTP ${res.status})`);
        }

        if (!cancelled) setUnits(body.units ?? []);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Failed to load units");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const flat = useMemo(() => {
    const rows: Array<{
      unitId: string;
      studioNumber: string;
      companyName: string | null;
      contactId: string;
      contactName: string;
      searchText: string;
    }> = [];

    for (const u of units) {
      for (const c of u.contacts ?? []) {
        const studio = u.studioNumber || u.unitId;
        const company = u.companyName ?? "";
        const name = c.name ?? "";
        rows.push({
          unitId: u.unitId,
          studioNumber: studio,
          companyName: u.companyName ?? null,
          contactId: c.id,
          contactName: name,
          searchText: `${studio} ${company} ${name}`.toLowerCase(),
        });
      }
    }

    for (const u of units) {
      if ((u.contacts?.length ?? 0) === 0) {
        const studio = u.studioNumber || u.unitId;
        const company = u.companyName ?? "";
        rows.push({
          unitId: u.unitId,
          studioNumber: studio,
          companyName: u.companyName ?? null,
          contactId: "",
          contactName: "Ring this unit",
          searchText: `${studio} ${company}`.toLowerCase(),
        });
      }
    }

    return rows;
  }, [units]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return flat;
    return flat.filter((r) => r.searchText.includes(q));
  }, [flat, query]);

  const showSearch = flat.length > 12;

  function goToRing(unitId: string, contactId: string) {
    const base = `/ring/${encodeURIComponent(unitId)}`;
    const url = contactId ? `${base}?contactId=${encodeURIComponent(contactId)}` : base;
    router.push(url);
  }

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: 20 }}>
      <h1 style={{ fontSize: 28, marginBottom: 6, color: "#111" }}>
        Who are you here for?
      </h1>
      <p style={{ marginTop: 0, color: "#444" }}>
        Select a person to ring their phone.
      </p>

      <div style={{ marginTop: 16 }}>
        {loading && (
          <div style={{ padding: 12, border: "1px solid #cfcfcf", borderRadius: 12 }}>
            <div style={{ fontWeight: 700, color: "#111" }}>Loading…</div>
            <div style={{ color: "#555" }}>One sec.</div>
          </div>
        )}

        {!loading && err && (
          <div style={{ padding: 12, border: "1px solid #e0a0a0", borderRadius: 12 }}>
            <div style={{ fontWeight: 800, color: "#111" }}>Can’t load units.</div>
            <div style={{ marginTop: 6, color: "#444" }}>{err}</div>
          </div>
        )}

        {!loading && !err && flat.length > 0 && (
          <>
            {showSearch && (
              <div style={{ marginBottom: 12 }}>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search studio, company, or name…"
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: 12,
                    border: "1px solid #cfcfcf",
                    fontSize: 16,
                    color: "#111",
                  }}
                />
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
              {filtered.map((r) => (
                <button
                  key={`${r.unitId}:${r.contactId || "unit"}`}
                  onClick={() => goToRing(r.unitId, r.contactId)}
                  style={{
                    textAlign: "left",
                    padding: "14px 14px",
                    borderRadius: 14,
                    border: "1px solid #cfcfcf",
                    background: "#fff",
                    cursor: "pointer",
                    minHeight: 64,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 900,
                      fontSize: 16,
                      color: "#111",
                    }}
                  >
                    {r.contactName}
                  </div>

                  <div
                    style={{
                      fontSize: 14,
                      marginTop: 4,
                      color: "#333",
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>{r.studioNumber}</span>
                    {r.companyName ? ` — ${r.companyName}` : ""}
                  </div>
                </button>
              ))}
            </div>

            <p style={{ marginTop: 18, color: "#555", fontSize: 13 }}>
              If you don’t see the person you need, contact reception or try again.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
