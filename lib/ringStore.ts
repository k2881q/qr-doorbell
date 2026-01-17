export type Ring = {
  id: number;
  unit: string;
  visitor?: string;
  time: string;
  createdAt: number; // epoch ms
  acknowledged: boolean;
  escalationStage: 0 | 1 | 2;
};

let rings: Ring[] = [];
let nextId = 1;

// Escalation timings (tweak these)
const SMS_DELAY_MS = 45_000;  // 45s
const CALL_DELAY_MS = 120_000; // 120s

let checkerStarted = false;

function startEscalationChecker() {
  if (checkerStarted) return;
  checkerStarted = true;

  setInterval(() => {
    const now = Date.now();

    for (const r of rings) {
      if (r.acknowledged) continue;

      const age = now - r.createdAt;

      // Stage 1: SMS
      if (r.escalationStage === 0 && age >= SMS_DELAY_MS) {
        r.escalationStage = 1;
        console.log(`[ESCALATE:SMS] Ring ${r.id} (${r.unit}) — visitor=${r.visitor ?? "?"} age=${Math.round(age/1000)}s`);
      }

  // Stage 2: Manual call recommended
if (r.escalationStage === 1 && age >= CALL_DELAY_MS) {
  r.escalationStage = 2;
  console.log(`[ESCALATE:MANUAL_CALL] Ring ${r.id} (${r.unit}) — recommend calling unit owner`);
}

    }
  }, 1000);
}

export function addRing(unit: string, visitor?: string) {
  startEscalationChecker();

  const ring: Ring = {
    id: nextId++,
    unit,
    visitor,
    time: new Date().toLocaleTimeString(),
    createdAt: Date.now(),
    acknowledged: false,
    escalationStage: 0,
  };

  rings.unshift(ring);
}

export function getRings() {
  return rings;
}

export function acknowledgeRing(id: number) {
  const r = rings.find((x) => x.id === id);
  if (r) r.acknowledged = true;
}
