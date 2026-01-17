"use client";

import { useEffect, useState } from "react";

type Ring = {
  id: number;
  unit: string;
  visitor?: string;
  time: string;
  createdAt: number;
  acknowledged: boolean;
  escalationStage: 0 | 1 | 2;
};

export default function Receiver() {
  const [rings, setRings] = useState<Ring[]>([]);
  const [err, setErr] = useState<string>("");

  async function refresh() {
    try {
      const res = await fetch("/api/rings", { cache: "no-store" });
      const data = (await res.json()) as { rings: Ring[] };
      setRings(data.rings ?? []);
      setErr("");
    } catch (e) {
      setErr("Failed to fetch rings");
    }
  }

  async function ack(id: number) {
    await fetch("/api/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await refresh();
  }

  useEffect(() => {
    refresh();
    const i = setInterval(refresh, 500);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>Receiver</h1>

      {err && <p style={{ color: "crimson" }}>{err}</p>}

      {rings.length === 0 ? (
        <p>No rings yet.</p>
      ) : (
        rings.map((r) => (
          <div key={r.id} style={{ marginBottom: 12 }}>
            <b>{r.unit}</b> — {r.time}
            {r.visitor ? ` — ${r.visitor}` : ""}
			
			<span style={{ marginLeft: 10, opacity: 0.6 }}>
  stage: {r.escalationStage}
</span>

{r.escalationStage === 2 && !r.acknowledged && (
  <div
    style={{
      marginTop: 8,
      padding: 10,
      borderRadius: 10,
      border: "1px solid #d97706",
      background: "#fffbeb",
    }}
  >
    <b>No response yet.</b> Consider calling the unit owner.
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => alert("In the real version: show phone number + tap-to-call")}
      >
        Call unit owner
      </button>
    </div>
  </div>
)}



            {r.acknowledged ? (
              <span> ✅ acknowledged</span>
            ) : (
              <button style={{ marginLeft: 10 }} onClick={() => ack(r.id)}>
                Acknowledge
              </button>
            )}
          </div>
        ))
      )}
    </main>
  );
}
