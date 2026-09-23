import type { HandEntry } from "./types.ts";

export const RULES = {
  finishBase: -101,
  noOpen: 202,
  okeyInHand: 101,
  chip101: 101,
  alipPer: 10,
  alipCift: 20,
  perBonus: [
    { gt: 180, points: -202 },
    { gt: 150, points: -101 },
  ],
  pairBonus: [
    { min: 9, points: -202 },
    { min: 7, points: -101 },
  ],
} as const;

export function openingBonus(entry: HandEntry): number {
  if (entry.open === "per" && entry.openingValue != null) {
    for (const row of RULES.perBonus) {
      if (entry.openingValue > row.gt) return row.points;
    }
  }
  if (entry.open === "cift" && entry.pairCount != null) {
    for (const row of RULES.pairBonus) {
      if (entry.pairCount >= row.min) return row.points;
    }
  }
  return 0;
}

export function elIci(entry: HandEntry): number {
  let n = 0;
  for (const p of entry.penalties) {
    if (p.kind === "alip_acma") {
      n += p.tile * (p.open === "cift" ? RULES.alipCift : RULES.alipPer);
    } else {
      n += RULES.chip101;
    }
  }
  return n;
}

export function elSonu(entry: HandEntry): number {
  if (entry.finished) return 0;
  if (entry.open === "none") return RULES.noOpen;
  const okeys = entry.okeyCount * RULES.okeyInHand;
  if (entry.open === "cift") return entry.remaining * 2 + okeys;
  return entry.remaining + okeys;
}

export function finishBonus(entry: HandEntry): number {
  if (!entry.finished) return 0;
  let m = 1;
  if (entry.open === "cift") m *= 2;
  if (entry.elden) m *= 2;
  if (entry.okeyFinish) m *= 2;
  return RULES.finishBase * m;
}

export function rawScore(entry: HandEntry): {
  sonu: number;
  ici: number;
  acis: number;
  bitis: number;
  ham: number;
} {
  const sonu = elSonu(entry);
  const ici = elIci(entry);
  const acis = openingBonus(entry);
  const bitis = finishBonus(entry);
  return { sonu, ici, acis, bitis, ham: sonu + ici + acis + bitis };
}

export function scoreHand(entries: [HandEntry, HandEntry, HandEntry, HandEntry]): [number, number, number, number] {
  const parts = entries.map(rawScore);
  const finisher = entries.findIndex((e) => e.finished);
  if (finisher < 0) {
    return parts.map((p) => p.ham) as [number, number, number, number];
  }
  const partner = (finisher + 2) % 4;
  return parts.map((p, i) => {
    if (i === finisher) return p.acis + p.bitis;
    if (i === partner) return 0;
    return p.ham;
  }) as [number, number, number, number];
}
