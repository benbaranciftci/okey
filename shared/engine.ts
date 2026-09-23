import { scoreHand } from "./rules.ts";
import {
  blankEntry,
  type ClientEvent,
  type GameState,
  type HandEntry,
  type Seat,
} from "./types.ts";

export type ApplyResult = { game: GameState; error?: string };

function ok(game: GameState): ApplyResult {
  return { game };
}

function err(game: GameState, error: string): ApplyResult {
  return { game, error };
}

function isHost(game: GameState, actorId: string): boolean {
  return game.hostId === actorId;
}

function actorPlayer(game: GameState, actorId: string) {
  return game.players.find((p) => p.id === actorId);
}

function sanitizeEntry(entry: HandEntry, seat: Seat): HandEntry {
  const remaining = Math.max(0, Math.round(Number(entry.remaining) || 0));
  const okeyCount = Math.min(2, Math.max(0, Math.round(Number(entry.okeyCount) || 0)));
  const openingValue =
    entry.openingValue == null ? null : Math.max(0, Math.round(Number(entry.openingValue) || 0));
  const pairCount =
    entry.pairCount == null ? null : Math.min(10, Math.max(0, Math.round(Number(entry.pairCount) || 0)));
  const penalties = Array.isArray(entry.penalties) ? entry.penalties.slice(0, 12) : [];
  const finished = Boolean(entry.finished);
  return {
    seat,
    open: entry.open === "per" || entry.open === "cift" ? entry.open : "none",
    remaining: entry.open === "none" || finished ? 0 : remaining,
    okeyCount: entry.open === "none" || finished ? 0 : okeyCount,
    openingValue: entry.open === "per" ? openingValue : null,
    pairCount: entry.open === "cift" ? pairCount : null,
    penalties: penalties.filter((p) => {
      if (p.kind === "alip_acma") {
        return p.tile >= 1 && p.tile <= 13 && (p.open === "per" || p.open === "cift");
      }
      return p.kind === "islek" || p.kind === "okey_atma" || p.kind === "hatali_acma";
    }),
    finished,
    elden: finished && Boolean(entry.elden),
    okeyFinish: finished && Boolean(entry.okeyFinish),
  };
}

export function applyEvent(game: GameState, actorId: string, event: ClientEvent): ApplyResult {
  switch (event.type) {
    case "hello": {
      const name = event.name.trim().slice(0, 16) || "Oyuncu";
      const existing = game.players.find((p) => p.id === actorId);
      if (existing) {
        return ok({
          ...game,
          players: game.players.map((p) =>
            p.id === actorId ? { ...p, name, connected: true } : p,
          ),
        });
      }
      if (game.players.length >= 4) {
        return err(game, "Masa dolu.");
      }
      const hostId = game.hostId || actorId;
      return ok({
        ...game,
        hostId,
        players: [
          ...game.players,
          { id: actorId, name, seat: null, connected: true, guest: false },
        ],
      });
    }
    case "rename": {
      const name = event.name.trim().slice(0, 16) || "Oyuncu";
      return ok({
        ...game,
        players: game.players.map((p) => (p.id === actorId ? { ...p, name } : p)),
      });
    }
    case "sit": {
      if (game.phase !== "lobby") return err(game, "Oyun başladı, koltuk değişmez.");
      const seat = event.seat;
      if (seat < 0 || seat > 3) return err(game, "Geçersiz koltuk.");
      const me = actorPlayer(game, actorId);
      if (!me) return err(game, "Önce masaya gir.");
      const taken = game.players.find((p) => p.seat === seat && p.id !== actorId);
      if (taken && !taken.guest) return err(game, "Koltuk dolu.");
      const players = game.players
        .filter((p) => !(taken?.guest && p.id === taken.id))
        .map((p) => (p.id === actorId ? { ...p, seat } : p.seat === seat ? { ...p, seat: null } : p));
      return ok({ ...game, players });
    }
    case "guest": {
      if (!isHost(game, actorId)) return err(game, "Sadece masa sahibi isim yazabilir.");
      if (game.phase !== "lobby") return err(game, "Oyun başladı.");
      const name = event.name.trim().slice(0, 16);
      if (!name) return err(game, "İsim yaz.");
      const seat = event.seat;
      const occupant = game.players.find((p) => p.seat === seat);
      if (occupant && !occupant.guest) return err(game, "Koltukta gerçek oyuncu var.");
      if (occupant?.guest) {
        return ok({
          ...game,
          players: game.players.map((p) => (p.id === occupant.id ? { ...p, name } : p)),
        });
      }
      if (game.players.length >= 4) return err(game, "Masa dolu.");
      return ok({
        ...game,
        players: [
          ...game.players,
          {
            id: `guest-${seat}-${crypto.randomUUID().slice(0, 8)}`,
            name,
            seat,
            connected: false,
            guest: true,
          },
        ],
      });
    }
    case "start": {
      if (!isHost(game, actorId)) return err(game, "Sadece masa sahibi başlatır.");
      if (game.phase !== "lobby") return err(game, "Oyun zaten başladı.");
      for (let s = 0; s < 4; s++) {
        if (!game.players.some((p) => p.seat === s)) {
          return err(game, "Dört koltuk da dolu olmalı (boşlara isim yazabilirsin).");
        }
      }
      return ok({ ...game, phase: "playing" });
    }
    case "endHand": {
      if (!isHost(game, actorId)) return err(game, "El bitirmeyi masa sahibi basar.");
      if (game.phase !== "playing") return err(game, "Şu an el oynanmıyor.");
      return ok({
        ...game,
        phase: "scoring",
        current: [blankEntry(0), blankEntry(1), blankEntry(2), blankEntry(3)],
      });
    }
    case "submit": {
      if (game.phase !== "scoring" || !game.current) return err(game, "El girişi açık değil.");
      const me = actorPlayer(game, actorId);
      if (!me) return err(game, "Masada değilsin.");
      const seat = event.entry.seat;
      const canEdit = isHost(game, actorId) || me.seat === seat;
      if (!canEdit) return err(game, "Bu koltuğu sen dolduramazsın.");
      if (seat < 0 || seat > 3) return err(game, "Geçersiz koltuk.");
      const next = [...game.current] as [HandEntry, HandEntry, HandEntry, HandEntry];
      const cleaned = sanitizeEntry(event.entry, seat);
      if (cleaned.finished) {
        for (let i = 0; i < 4; i++) {
          if (i !== seat) next[i] = { ...next[i], finished: false, elden: false, okeyFinish: false };
        }
      }
      next[seat] = cleaned;
      return ok({ ...game, current: next });
    }
    case "lock": {
      if (!isHost(game, actorId)) return err(game, "Puanı masa sahibi yazar.");
      if (game.phase !== "scoring" || !game.current) return err(game, "Yazılacak el yok.");
      const finishers = game.current.filter((e) => e.finished);
      if (finishers.length > 1) return err(game, "Bir el bir kişi biter.");
      const scores = scoreHand(game.current);
      const totals: [number, number, number, number] = [
        game.totals[0] + scores[0],
        game.totals[1] + scores[1],
        game.totals[2] + scores[2],
        game.totals[3] + scores[3],
      ];
      return ok({
        ...game,
        phase: "playing",
        current: null,
        history: [...game.history, { scores }],
        totals,
      });
    }
    case "next": {
      if (!isHost(game, actorId)) return err(game, "Sadece masa sahibi.");
      if (game.phase === "scoring") return err(game, "Önce eli kilitle.");
      return ok({ ...game, phase: "playing", current: null });
    }
    case "resetScores": {
      if (!isHost(game, actorId)) return err(game, "Sadece masa sahibi sıfırlar.");
      return ok({
        ...game,
        phase: "lobby",
        current: null,
        history: [],
        totals: [0, 0, 0, 0],
      });
    }
    default:
      return err(game, "Bilinmeyen olay.");
  }
}
