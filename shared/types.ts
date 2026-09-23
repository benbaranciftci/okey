export type Seat = 0 | 1 | 2 | 3;

export type OpenKind = "none" | "per" | "cift";

export type PenaltyChip =
  | { kind: "islek" }
  | { kind: "okey_atma" }
  | { kind: "hatali_acma" }
  | { kind: "alip_acma"; tile: number; open: "per" | "cift" };

export type HandEntry = {
  seat: Seat;
  open: OpenKind;
  remaining: number;
  okeyCount: number;
  openingValue: number | null;
  pairCount: number | null;
  penalties: PenaltyChip[];
  finished: boolean;
  elden: boolean;
  okeyFinish: boolean;
};

export type Player = {
  id: string;
  name: string;
  seat: Seat | null;
  connected: boolean;
  guest: boolean;
};

export type HandHistory = {
  scores: [number, number, number, number];
};

export type Phase = "lobby" | "playing" | "scoring";

export type GameState = {
  code: string;
  hostId: string;
  players: Player[];
  phase: Phase;
  current: [HandEntry, HandEntry, HandEntry, HandEntry] | null;
  history: HandHistory[];
  totals: [number, number, number, number];
};

export type ClientEvent =
  | { type: "hello"; playerId: string; name: string }
  | { type: "rename"; name: string }
  | { type: "sit"; seat: Seat }
  | { type: "guest"; seat: Seat; name: string }
  | { type: "start" }
  | { type: "endHand" }
  | { type: "submit"; entry: HandEntry }
  | { type: "lock" }
  | { type: "next" }
  | { type: "resetScores" };

export type ServerMessage =
  | { type: "state"; game: GameState; youId: string }
  | { type: "error"; message: string };

export const TEAMS: [[Seat, Seat], [Seat, Seat]] = [
  [0, 2],
  [1, 3],
];

export function partnerOf(seat: Seat): Seat {
  return ((seat + 2) % 4) as Seat;
}

export function blankEntry(seat: Seat): HandEntry {
  return {
    seat,
    open: "none",
    remaining: 0,
    okeyCount: 0,
    openingValue: null,
    pairCount: null,
    penalties: [],
    finished: false,
    elden: false,
    okeyFinish: false,
  };
}

export function emptyGame(code: string): GameState {
  return {
    code,
    hostId: "",
    players: [],
    phase: "lobby",
    current: null,
    history: [],
    totals: [0, 0, 0, 0],
  };
}

export function playerAtSeat(game: GameState, seat: Seat): Player | undefined {
  return game.players.find((p) => p.seat === seat);
}

export function teamNames(game: GameState, seats: [Seat, Seat]): string {
  const a = playerAtSeat(game, seats[0])?.name ?? `Koltuk ${seats[0] + 1}`;
  const b = playerAtSeat(game, seats[1])?.name ?? `Koltuk ${seats[1] + 1}`;
  return `${a} + ${b}`;
}

export function teamTotal(totals: [number, number, number, number], seats: [Seat, Seat]): number {
  return totals[seats[0]] + totals[seats[1]];
}
