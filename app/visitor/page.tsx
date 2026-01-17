"use client";

export default function Visitor() {
  async function ring(unit: string) {
    await fetch("/api/ring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        unit,
        visitor: "Visitor",
      }),
    });

    new Notification("Doorbell", {
      body: `Someone rang for ${unit}`,
    });

    alert(`Rang ${unit}`);
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Visitor</h1>
      <p>Select a unit:</p>

      <button onClick={() => ring("Unit A")}>Ring Unit A</button>
      <br /><br />
      <button onClick={() => ring("Unit B")}>Ring Unit B</button>
    </main>
  );
}
