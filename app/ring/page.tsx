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

        const res = await fetch("/api/units/public", { method: "GET" });
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
    // Flatten into "who are you here for" entries, because that’s the primary intent.
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

    // If a unit has zero contacts, we keep the unit itself as a fallback target.
    for (const u of units) {
      if ((u.contacts?.length ?? 0) === 0) {
        const studio = u.studioNumber || u.unitId;
        const company = u.companyName ?? "";
        rows.push({
          unitId: u.unitId,
          studioNumber: studio,
          companyName: u.companyName ?? null,
          contactId: "", // indicates "general"
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
      <h1 style={{ fontSize: 28, marginBottom: 6 }}>Who are you here for?</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Select a person to ring their phone.
      </p>

      <div style={{ marginTop: 16 }}>
        {loading && (
          <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
            <div style={{ fontWeight: 700 }}>Loading…</div>
            <div style={{ opacity: 0.75 }}>One sec.</div>
          </div>
        )}

        {!loading && err && (
          <div style={{ padding: 12, border: "1px solid #f2b8b8", borderRadius: 12 }}>
            <div style={{ fontWeight: 800 }}>Can’t load units.</div>
            <div style={{ marginTop: 6, opacity: 0.8 }}>{err}</div>
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: 10,
                padding: "10px 12px",
                borderRadius: 12,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !err && flat.length === 0 && (
          <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
            <div style={{ fontWeight: 800 }}>No units available.</div>
            <div style={{ marginTop: 6, opacity: 0.8 }}>
              Please contact reception or try again later.
            </div>
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
                    padding: "12px 12px",
                    borderRadius: 12,
                    border: "1px solid #ddd",
                    fontSize: 16,
                  }}
                />
              </div>
            )}

            {filtered.length === 0 ? (
              <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
                <div style={{ fontWeight: 800 }}>No matches.</div>
                <div style={{ marginTop: 6, opacity: 0.8 }}>
                  Try a different name, company, or studio number.
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
                {filtered.map((r) => (
                  <button
                    key={`${r.unitId}:${r.contactId || "unit"}`}
                    onClick={() => goToRing(r.unitId, r.contactId)}
                    style={{
                      textAlign: "left",
                      padding: "14px 12px",
                      borderRadius: 14,
                      border: "1px solid #ddd",
                      background: "white",
                      cursor: "pointer",
                      minHeight: 64,
                    }}
                  >
                    <div style={{ fontWeight: 900, fontSize: 16 }}>
                      {r.contactName}
                    </div>

                    <div style={{ opacity: 0.85, fontSize: 13, marginTop: 3 }}>
                      <span style={{ fontWeight: 700 }}>{r.studioNumber}</span>
                      {r.companyName ? ` — ${r.companyName}` : ""}
                    </div>
                  </button>
                ))}
              </div>
            )}

            <p style={{ marginTop: 18, opacity: 0.75, fontSize: 13 }}>
              If you don’t see the person you need, contact reception or try again.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
