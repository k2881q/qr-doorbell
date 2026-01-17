"use client";



import { useMemo, useState } from "react";

const btnStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #111",
  background: "#111",
  color: "#fff",
  cursor: "pointer",
  fontWeight: 600,
};

const btnDisabled: React.CSSProperties = {
  opacity: 0.4,
  cursor: "not-allowed",
};

export default function Home() {
  const supported = useMemo(
    () => typeof window !== "undefined" && "Notification" in window,
    []
  );

  const [perm, setPerm] = useState<string>(
    supported ? Notification.permission : "unsupported"
  );

async function enableNotifications() {
  console.log("Enable clicked");
  if (!supported) {
    console.log("Notifications not supported");
    return;
  }
  console.log("Before request:", Notification.permission);
  const p = await Notification.requestPermission();
  console.log("After request:", p);
  setPerm(p);
}



function testNotification() {
  console.log("Test clicked");
  console.log("Permission at click:", perm);

  if (!supported) {
    console.log("Notifications not supported");
    return;
  }
  if (perm !== "granted") {
    console.log("Not granted, cannot notify");
    return;
  }

  try {
    const n = new Notification("Doorbell test", {
      body: "If you can see/hear this, desktop notifications are working.",
    });
    console.log("Notification object created:", n);
  } catch (e) {
    console.error("Notification failed:", e);
  }
}


  const canTest = supported && perm === "granted";


  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 720 }}>
      <h1 style={{ marginBottom: 6 }}>Doorbell (Windows Desktop Test)</h1>

      <p style={{ lineHeight: 1.6 }}>
        Notifications supported: <b>{String(supported)}</b>
        <br />
        Permission: <b>{perm}</b>
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button style={btnStyle} onClick={enableNotifications} disabled={!supported}>
          Enable notifications
        </button>

        <button
          style={{ ...btnStyle, ...(canTest ? {} : btnDisabled) }}
          onClick={testNotification}
          disabled={!canTest}
        >
          Test notification
        </button>
      </div>

      <p style={{ marginTop: 16, opacity: 0.8 }}>
        Next step: we’ll add a “Ring” event and then real push via the service worker
        (tested in local production mode).
      </p>
    </main>
  );
}
