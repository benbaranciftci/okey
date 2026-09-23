import { applyEvent } from "../shared/engine.ts";
import { generateCode, normalizeCode } from "../shared/code.ts";
import { blankEntry, emptyGame, type ClientEvent, type GameState, type HandEntry, type OpenKind, type Seat } from "../shared/types.ts";
import { renderHome, renderTable } from "./ui.ts";

const PID_KEY = "okey.pid";
const NAME_KEY = "okey.name";

function playerId(): string {
  let id = localStorage.getItem(PID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(PID_KEY, id);
  }
  return id;
}

type Model = {
  screen: "home" | "table";
  solo: boolean;
  name: string;
  codeInput: string;
  youId: string;
  game: GameState | null;
  form: HandEntry;
  formSeat: Seat;
  guestName: string;
  toast: string;
  toastOk: boolean;
  error: string;
  ws: WebSocket | null;
  alip: { tile: number; open: "per" | "cift" } | null;
  lastPhase: GameState["phase"] | null;
};

const model: Model = {
  screen: "home",
  solo: false,
  name: localStorage.getItem(NAME_KEY) ?? "",
  codeInput: "",
  youId: playerId(),
  game: null,
  form: blankEntry(0),
  formSeat: 0,
  guestName: "",
  toast: "",
  toastOk: false,
  error: "",
  ws: null,
  alip: null,
  lastPhase: null,
};

const root = document.getElementById("app")!;

function toast(message: string, ok = false) {
  model.toast = message;
  model.toastOk = ok;
  render();
  if (message) {
    window.setTimeout(() => {
      if (model.toast === message) {
        model.toast = "";
        render();
      }
    }, 3200);
  }
}

function render() {
  if (model.screen === "home" || !model.game) {
    root.innerHTML = renderHome({
      name: model.name,
      code: model.codeInput,
      error: model.error,
    });
    return;
  }
  root.innerHTML = renderTable({
    game: model.game,
    youId: model.youId,
    form: model.form,
    formSeat: model.formSeat,
    guestName: model.guestName,
    toast: model.toast,
    toastOk: model.toastOk,
    solo: model.solo,
    alip: model.alip,
  });
}

function send(event: ClientEvent) {
  if (model.solo) {
    if (!model.game) return;
    const prev = model.game.phase;
    const result = applyEvent(model.game, model.youId, event);
    if (result.error) toast(result.error);
    model.game = result.game;
    const me = model.game.players.find((p) => p.id === model.youId);
    if (model.game.phase === "scoring" && prev !== "scoring" && me?.seat != null) {
      model.formSeat = me.seat;
    }
    model.lastPhase = model.game.phase;
    syncFormFromGame();
    localStorage.setItem("okey.solo", JSON.stringify(model.game));
    if (prev === "scoring" && model.game.phase === "playing") toast("El yazıldı.", true);
    render();
    return;
  }
  if (!model.ws || model.ws.readyState !== WebSocket.OPEN) {
    toast("Bağlantı yok.");
    return;
  }
  model.ws.send(JSON.stringify(event));
}

function syncFormFromGame() {
  const g = model.game;
  if (!g?.current) return;
  const entry = g.current[model.formSeat];
  if (entry) model.form = { ...entry, penalties: [...entry.penalties] };
}

function connect(code: string) {
  model.ws?.close();
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/ws/${code}`);
  model.ws = ws;
  ws.addEventListener("open", () => {
    ws.send(
      JSON.stringify({
        type: "hello",
        playerId: model.youId,
        name: model.name.trim() || "Oyuncu",
      } satisfies ClientEvent),
    );
  });
  ws.addEventListener("message", (ev) => {
    if (ev.data === "pong") return;
    try {
      const msg = JSON.parse(String(ev.data)) as { type: string; game?: GameState; youId?: string; message?: string };
      if (msg.type === "error" && msg.message) {
        toast(msg.message);
        return;
      }
      if (msg.type === "state" && msg.game) {
        model.game = msg.game;
        model.screen = "table";
        model.error = "";
        const prev = model.lastPhase;
        model.lastPhase = msg.game.phase;
        const me = msg.game.players.find((p) => p.id === model.youId);
        if (me?.seat != null && msg.game.phase !== "scoring") model.formSeat = me.seat;
        if (msg.game.phase === "scoring" && prev !== "scoring" && me?.seat != null) {
          model.formSeat = me.seat;
        }
        if (prev === "scoring" && msg.game.phase === "playing") toast("El yazıldı.", true);
        if (model.game.phase === "scoring") syncFormFromGame();
        render();
      }
    } catch {}
  });
  ws.addEventListener("close", () => {
    if (model.screen === "table" && !model.solo) toast("Bağlantı koptu, yenile.");
  });
}

function requireName(): boolean {
  model.name = model.name.trim();
  if (!model.name) {
    model.error = "Adını yaz.";
    render();
    return false;
  }
  localStorage.setItem(NAME_KEY, model.name);
  return true;
}

function startSolo() {
  if (!requireName()) return;
  model.solo = true;
  model.youId = playerId();
  model.game = emptyGame("SOLO");
  const hello = applyEvent(model.game, model.youId, {
    type: "hello",
    playerId: model.youId,
    name: model.name,
  });
  model.game = hello.game;
  model.screen = "table";
  render();
}

function startOnline(code: string) {
  if (!requireName()) return;
  model.solo = false;
  model.screen = "table";
  model.game = emptyGame(code);
  connect(code);
  render();
}

root.addEventListener("input", (ev) => {
  const t = ev.target as HTMLElement;
  if (!(t instanceof HTMLInputElement)) return;
  const field = t.dataset.field;
  if (field === "name") model.name = t.value;
  if (field === "code") model.codeInput = t.value.toUpperCase();
  if (field === "guestName") model.guestName = t.value;
  if (field === "remaining") model.form.remaining = Number(t.value) || 0;
  if (field === "openingValue") model.form.openingValue = t.value === "" ? null : Number(t.value) || 0;
  if (field === "pairCount") model.form.pairCount = t.value === "" ? null : Number(t.value) || 0;
});

root.addEventListener("click", (ev) => {
  const t = (ev.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
  if (!t) return;
  const act = t.dataset.act;
  if (act === "create") startOnline(generateCode());
  if (act === "join") {
    const code = normalizeCode(model.codeInput);
    if (!code) {
      model.error = "4 harfli kod yaz.";
      render();
      return;
    }
    startOnline(code);
  }
  if (act === "solo") startSolo();
  if (act === "sit") send({ type: "sit", seat: Number(t.dataset.seat) as Seat });
  if (act === "guest") {
    send({ type: "guest", seat: Number(t.dataset.seat) as Seat, name: model.guestName });
  }
  if (act === "start") send({ type: "start" });
  if (act === "end-hand") send({ type: "endHand" });
  if (act === "reset") {
    if (confirm("Skorlar sıfırlansın mı?")) send({ type: "resetScores" });
  }
  if (act === "copy") {
    const url = `${location.origin}${location.pathname}?oda=${model.game?.code ?? ""}`;
    void navigator.clipboard.writeText(url).then(
      () => toast("Link kopyalandı.", true),
      () => toast(url, true),
    );
  }
  if (act === "form-seat") {
    model.formSeat = Number(t.dataset.seat) as Seat;
    syncFormFromGame();
    render();
  }
  if (act === "open") {
    model.form.open = t.dataset.v as OpenKind;
    render();
  }
  if (act === "okey") {
    const d = Number(t.dataset.d);
    model.form.okeyCount = Math.min(2, Math.max(0, model.form.okeyCount + d));
    render();
  }
  if (act === "toggle") {
    const k = t.dataset.k as "finished" | "elden" | "okeyFinish";
    model.form[k] = !model.form[k];
    if (k === "finished" && !model.form.finished) {
      model.form.elden = false;
      model.form.okeyFinish = false;
    }
    if ((k === "elden" || k === "okeyFinish") && model.form[k]) model.form.finished = true;
    render();
  }
  if (act === "chip") {
    const k = t.dataset.k;
    if (k === "alip_acma") {
      model.alip = { tile: 7, open: model.form.open === "cift" ? "cift" : "per" };
      render();
      return;
    }
    if (k === "islek" || k === "okey_atma" || k === "hatali_acma") {
      model.form.penalties = [...model.form.penalties, { kind: k }];
      render();
    }
  }
  if (act === "del-chip") {
    const i = Number(t.dataset.i);
    model.form.penalties = model.form.penalties.filter((_, idx) => idx !== i);
    render();
  }
  if (act === "alip-tile") {
    if (model.alip) model.alip = { ...model.alip, tile: Number(t.dataset.n) };
    render();
  }
  if (act === "alip-open") {
    if (model.alip) model.alip = { ...model.alip, open: t.dataset.v === "cift" ? "cift" : "per" };
    render();
  }
  if (act === "alip-ok" && model.alip) {
    model.form.penalties = [
      ...model.form.penalties,
      { kind: "alip_acma", tile: model.alip.tile, open: model.alip.open },
    ];
    model.alip = null;
    render();
  }
  if (act === "alip-cancel") {
    model.alip = null;
    render();
  }
  if (act === "submit") {
    model.form.seat = model.formSeat;
    send({ type: "submit", entry: model.form });
    toast("Kaydedildi.", true);
  }
  if (act === "lock") send({ type: "lock" });
});

export function boot() {
  const params = new URLSearchParams(location.search);
  const oda = params.get("oda");
  if (oda) {
    const code = normalizeCode(oda);
    if (code) model.codeInput = code;
  }
  render();
  if (oda && model.name) {
    const code = normalizeCode(oda);
    if (code) startOnline(code);
  }
}
