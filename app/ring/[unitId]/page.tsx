"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { isTerminalStatus } from "@/lib/ringTypes";
import type { RingEventStatus } from "@/lib/ringTypes";

type RingStatus =
  | "idle"
  | "ringing"
  | "ringed"
  | "sms_sent"
  | "call_prompt"
  | "answered"
  | "error";

type PublicContact = { id: string; name: string };
type PublicUnit = {
  unitId: string;
  studioNumber: string;
  companyName: string | null;
  contacts: PublicContact[];
};

export default function RingUnitPage() {
  const params = useParams();
  const searchParams = useSearchParams();

  const rawUnitId = (params as any)?.unitId;
  const unitId =
    typeof rawUnitId === "string"
      ? decodeURIComponent(rawUnitId)
      : Array.isArray(rawUnitId)
      ? decodeURIComponent(rawUnitId[0] ?? "")
      : "";

  const contactIdFromUrl = searchParams?.get("contactId") ?? null;

  const [ringEventId, setRingEventId] = useState<string | null>(null);

  // For the 2-minute "call owner?" prompt
  const [ownerPhone, setOwnerPhone] = useState<string | null>(null);

  const [status, setStatus] = useState<RingStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Friendly message when receiver responds
  const [responseType, setResponseType] = useState<string | null>(null);

  // Optional visitor-provided context
  const [visitorName, setVisitorName] = useState("");
  const [visitReason, setVisitReason] = useState("");

  // Display context (who they’re ringing)
  const [unitMeta, setUnitMeta] = useState<PublicUnit | null>(null);
  const [targetName, setTargetName] = useState<string | null>(null);
  const [unitInfoError, setUnitInfoError] = useState<string | null>(null);

  const smsTimerRef = useRef<number | null>(null);
  const callTimerRef = useRef<number | null>(null);

  const isEscalating =
    status === "ringed" || status === "sms_sent" || status === "call_prompt";

  const inputsDisabled = isLoading || isEscalating || status === "answered";

  const tryBrowserNotify = async (title: string, body?: string) => {
    try {
      if (typeof window === "undefined") return;
      if (!("Notification" in window)) return;

      if (Notification.permission !== "granted") {
        const p = await Notification.requestPermission();
        if (p !== "granted") return;
      }

      new Notification(title, body ? { body } : undefined);
    } catch {
      // ignore
    }
  };

  const clearTimers = () => {
    if (smsTimerRef.current) window.clearTimeout(smsTimerRef.current);
    if (callTimerRef.current) window.clearTimeout(callTimerRef.current);
    smsTimerRef.current = null;
    callTimerRef.current = null;
  };

  useEffect(() => {
    return () => clearTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load unit + contact name for friendly display (no secrets)
  useEffect(() => {
    let cancelled = false;

    async function loadMeta() {
      if (!unitId) return;

      try {
        setUnitInfoError(null);

        const res = await fetch("/api/units/public", { method: "GET" });
        const body = await res.json().catch(() => null);

        if (!res.ok || !body?.ok) {
          throw new Error(body?.error || `Failed to load units (HTTP ${res.status})`);
        }

        const units: PublicUnit[] = body.units ?? [];
        const found = units.find((u) => u.unitId === unitId) ?? null;

        if (!cancelled) {
          setUnitMeta(found);

          if (contactIdFromUrl && found?.contacts?.length) {
            const c = found.contacts.find((x) => x.id === contactIdFromUrl) ?? null;
            setTargetName(c?.name ?? null);
          } else {
            setTargetName(null);
          }
        }
      } catch (e: any) {
        if (!cancelled) setUnitInfoError(e?.message ?? "Failed to load unit info");
      }
    }

    loadMeta();
    return () => {
      cancelled = true;
    };
  }, [unitId, contactIdFromUrl]);

  const startEscalationTimers = (activeRingEventId: string) => {
    clearTimers();

    // After 45s: log SMS attempt server-side (real SMS later)
    smsTimerRef.current = window.setTimeout(async () => {
      try {
        await fetch("/api/notify/sms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ringEventId: activeRingEventId }),
        });
      } catch {
        // Don’t break visitor UX if logging fails
      } finally {
        setStatus((prev) => (prev === "ringed" ? "sms_sent" : prev));
      }
    }, 45_000);

    // After 2m: show visitor prompt “Call owner?”
    callTimerRef.current = window.setTimeout(() => {
      setStatus("call_prompt");
    }, 120_000);
  };

  // Poll status so escalation stops if receiver responds
  useEffect(() => {
    if (!ringEventId) return;
    if (!isEscalating) return;

    let stopped = false;

    const interval = window.setInterval(async () => {
      if (stopped) return;

      try {
        const res = await fetch(
          `/api/ring/status?ringEventId=${encodeURIComponent(ringEventId)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;

        const data = await res.json();

        if (data?.status && isTerminalStatus(data.status as RingEventStatus)) {
          clearTimers();
          setResponseType(data?.responseType ?? null);
          setStatus("answered");
          stopped = true;
          window.clearInterval(interval);
        }
      } catch {
        // ignore
      }
    }, 2000);

    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringEventId, isEscalating]);

  const ring = async () => {
    if (!unitId) {
      setError("No unitId in URL (e.g. /ring/f1u4)");
      setStatus("error");
      return;
    }

    // In the new flow, /ring chooses a person and passes contactId.
    // We still allow ringing a unit without a contactId (fallback),
    // but we nudge the user if the unit has contacts and none was selected.
    if (unitMeta?.contacts?.length && !contactIdFromUrl) {
      setError("Please go back and select the person you’re here for.");
      setStatus("error");
      return;
    }

    const who = targetName ? `Ringing ${targetName}…` : `Ringing unit ${unitId}…`;
    await tryBrowserNotify("Doorbell", who);

    setIsLoading(true);
    setError(null);
    setResponseType(null);
    setStatus("ringing");

    try {
      const res = await fetch("/api/ring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unitId,
          contactId: contactIdFromUrl, // <-- NEW
          visitorName: visitorName.trim() || null,
          visitReason: visitReason.trim() || null,
        }),
      });

      const data = await res.json();

      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error ?? "Failed to ring");
      }

      // Your /api/ring returns ringEvent (per our update). Support older shapes too.
      const newRingEventId: string | undefined =
        data?.ringEvent?.id ?? data?.ringEventId;

      if (!newRingEventId) throw new Error("Missing ringEventId from /api/ring");

      setRingEventId(newRingEventId);

      // Still supported for the "call owner?" prompt if your API returns it.
      setOwnerPhone(data?.ownerPhone ?? null);

      setStatus("ringed");
      startEscalationTimers(newRingEventId);

      await tryBrowserNotify("Doorbell", "Ring sent to receiver.");
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong");
      setStatus("error");
    } finally {
      setIsLoading(false);
    }
  };

  const reset = () => {
    clearTimers();
    setRingEventId(null);
    setOwnerPhone(null);
    setStatus("idle");
    setResponseType(null);
    setError(null);
    setIsLoading(false);
  };

  const ringDisabled = isLoading || !unitId || isEscalating || status === "answered";

  const headerStudio = unitMeta?.studioNumber ?? unitId || "(missing)";
  const headerCompany = unitMeta?.companyName ?? null;

  return (
    <div style={{ padding: 24, maxWidth: 560 }}>
      <div style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>
          {targetName ? `Ring ${targetName}` : `Ring ${headerStudio}`}
        </h1>

        <div style={{ marginTop: 6, opacity: 0.85 }}>
          <span style={{ fontWeight: 700 }}>{headerStudio}</span>
          {headerCompany ? ` — ${headerCompany}` : ""}
        </div>

        {contactIdFromUrl && !targetName && (
          <div style={{ marginTop: 6, opacity: 0.75, fontSize: 13 }}>
            (This person isn’t listed for this unit. Please go back and select again.)
          </div>
        )}

        {unitInfoError && (
          <div style={{ marginTop: 10, opacity: 0.8, fontSize: 13 }}>
            Couldn’t load unit info: {unitInfoError}
          </div>
        )}
      </div>

      {/* Optional visitor info */}
      <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 600 }}>Your name (optional)</span>
          <input
            value={visitorName}
            onChange={(e) => setVisitorName(e.target.value)}
            placeholder="e.g. Manon"
            style={{ padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
            disabled={inputsDisabled}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 600 }}>Reason for visit (optional)</span>
          <textarea
            value={visitReason}
            onChange={(e) => setVisitReason(e.target.value)}
            placeholder="e.g. Delivery / here for a meeting / maintenance"
            style={{
              padding: 10,
              border: "1px solid #ccc",
              borderRadius: 8,
              minHeight: 70,
            }}
            disabled={inputsDisabled}
          />
        </label>
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <button onClick={ring} disabled={ringDisabled}>
          {isLoading ? "Ringing…" : "Ring"}
        </button>

        <button onClick={reset} disabled={isLoading}>
          Reset
        </button>

        {/* Helpful escape hatch if they landed here without a selection */}
        {unitMeta?.contacts?.length && !contactIdFromUrl && (
          <button
            type="button"
            onClick={() => (window.location.href = "/ring")}
            disabled={isLoading}
          >
            Back to list
          </button>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <div>
          <strong>Status:</strong> {status}
        </div>

        {ringEventId && (
          <div>
            <strong>Ring Event ID:</strong> {ringEventId}
          </div>
        )}

        {status === "answered" && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              border: "1px solid #ddd",
              borderRadius: 10,
            }}
          >
            <p style={{ margin: 0 }}>
              <strong>✅ The unit responded.</strong>
            </p>

            {responseType === "busy" && (
              <p style={{ margin: "8px 0 0" }}>
                They can’t answer right now. Please wait a bit before trying again.
              </p>
            )}

            {responseType === "declined" && (
              <p style={{ margin: "8px 0 0" }}>They declined the doorbell.</p>
            )}

            {(!responseType || responseType === "answered") && (
              <p style={{ margin: "8px 0 0" }}>
                Someone should be coming to you shortly.
              </p>
            )}

            <button style={{ marginTop: 12 }} onClick={reset}>
              Ring again
            </button>
          </div>
        )}

        {(status === "ringed" || status === "sms_sent" || status === "call_prompt") && (
          <div style={{ marginTop: 10 }}>
            <div>✅ Push queued/sent to owner.</div>

            {status === "sms_sent" || status === "call_prompt" ? (
              <div>✅ SMS queued/sent to owner (45s reminder).</div>
            ) : (
              <div>⏳ If no response, SMS will queue after 45 seconds.</div>
            )}
          </div>
        )}

        {status === "call_prompt" && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              border: "1px solid #ccc",
              borderRadius: 8,
            }}
          >
            <div style={{ marginBottom: 8 }}>
              The unit owner isn’t responding to the doorbell notification.
            </div>

            {ownerPhone ? (
              <a
                href={`tel:${ownerPhone}`}
                style={{
                  display: "inline-block",
                  padding: "10px 12px",
                  border: "1px solid #111",
                  borderRadius: 8,
                }}
              >
                Call the unit owner
              </a>
            ) : (
              <div>(No phone number configured for this unit yet.)</div>
            )}
          </div>
        )}

        {error && (
          <div style={{ marginTop: 8 }}>
            <strong>Error:</strong> {error}
          </div>
        )}
      </div>
    </div>
  );
}
