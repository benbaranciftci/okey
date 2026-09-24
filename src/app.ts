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
  roomCode: string;
  wantSocket: boolean;
  reconnecting: boolean;
  reconnectAttempt: number;
  reconnectTimer: number | null;
  pingTimer: number | null;
  pongTimer: number | null;
  alip: { tile: number; open: "per" | "cift" } | null;
  openHand: number | null;
  lastPhase: GameState["phase"] | null;
  formDirty: boolean;
  pendingSubmit: HandEntry | null;
  qrOpen: boolean;
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
  roomCode: "",
  wantSocket: false,
  reconnecting: false,
  reconnectAttempt: 0,
  reconnectTimer: null,
  pingTimer: null,
  pongTimer: null,
  alip: null,
  openHand: null,
  lastPhase: null,
  formDirty: false,
  pendingSubmit: null,
  qrOpen: false,
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

function noteTransition(prevPhase: GameState["phase"] | null, prevHistory: number, next: GameState) {
  if (model.openHand != null && model.openHand >= next.history.length) model.openHand = null;
  if (prevPhase === "scoring" && next.phase === "playing" && next.history.length > prevHistory) {
    toast("El yazıldı.", true);
    return;
  }
  if (prevPhase === "scoring" && next.phase === "playing") {
    toast("El iptal edildi.", true);
    return;
  }
  if (prevHistory > next.history.length) toast("Son el geri alındı.", true);
}

function renderKeepingFocus() {
  const active = document.activeElement;
  const field = active instanceof HTMLInputElement ? active.dataset.field ?? "" : "";
  const start = active instanceof HTMLInputElement ? active.selectionStart : null;
  const end = active instanceof HTMLInputElement ? active.selectionEnd : null;
  render();
  if (!field) return;
  const next = root.querySelector(`input[data-field="${field}"]`);
  if (next instanceof HTMLInputElement) {
    next.focus();
    if (start != null && end != null) next.setSelectionRange(start, end);
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
    reconnecting: model.reconnecting,
    qrOpen: model.qrOpen,
    joinUrl: roomLink(model.game.code),
    openHand: model.openHand,
    alip: model.alip,
  });
}

function send(event: ClientEvent) {
  if (model.solo) {
    if (!model.game) return;
    const prev = model.game.phase;
    const prevHistory = model.game.history.length;
    const result = applyEvent(model.game, model.youId, event);
    if (result.error) toast(result.error);
    model.game = result.game;
    if (model.game.phase !== "lobby") model.qrOpen = false;
    const me = model.game.players.find((p) => p.id === model.youId);
    if (model.game.phase === "scoring" && prev !== "scoring") {
      model.formDirty = false;
      if (me?.seat != null) model.formSeat = me.seat;
    }
    model.lastPhase = model.game.phase;
    syncFormFromGame();
    localStorage.setItem("okey.solo", JSON.stringify(model.game));
    if (!result.error) noteTransition(prev, prevHistory, model.game);
    render();
    return;
  }
  if (!model.ws || model.ws.readyState !== WebSocket.OPEN) {
    toast(model.reconnecting ? "Yeniden bağlanıyor." : "Bağlantı yok.");
    nudgeReconnect();
    return;
  }
  model.ws.send(JSON.stringify(event));
}

function cloneEntry(entry: HandEntry): HandEntry {
  return { ...entry, penalties: entry.penalties.map((p) => ({ ...p })) };
}

function entryKey(entry: HandEntry): string {
  return JSON.stringify([
    entry.seat,
    entry.open,
    entry.remaining,
    entry.okeyCount,
    entry.openingValue,
    entry.pairCount,
    entry.penalties,
    entry.finished,
    entry.elden,
    entry.okeyFinish,
    entry.saved,
  ]);
}

function syncFormFromGame() {
  if (model.formDirty) return;
  const g = model.game;
  if (!g?.current) return;
  const entry = g.current[model.formSeat];
  if (entry) model.form = cloneEntry(entry);
}

function absorbState(game: GameState): GameState {
  const pending = model.pendingSubmit;
  if (!pending) return game;
  if (game.phase !== "scoring" || !game.current) {
    model.pendingSubmit = null;
    return game;
  }
  const remote = game.current[pending.seat];
  if (remote && entryKey(remote) === entryKey(pending)) {
    model.pendingSubmit = null;
    return game;
  }
  if (remote?.saved) {
    model.pendingSubmit = null;
    return game;
  }
  const merged = applyEvent(game, model.youId, { type: "submit", entry: pending });
  if (merged.error) {
    model.pendingSubmit = null;
    return game;
  }
  return merged.game;
}

function touchForm() {
  model.formDirty = true;
}

function stopHeartbeat() {
  if (model.pingTimer != null) {
    window.clearInterval(model.pingTimer);
    model.pingTimer = null;
  }
  if (model.pongTimer != null) {
    window.clearTimeout(model.pongTimer);
    model.pongTimer = null;
  }
}

function armPongTimeout(ws: WebSocket) {
  if (model.pongTimer != null) window.clearTimeout(model.pongTimer);
  model.pongTimer = window.setTimeout(() => {
    model.pongTimer = null;
    if (model.ws === ws && ws.readyState === WebSocket.OPEN) ws.close();
  }, 8000);
}

function startHeartbeat(ws: WebSocket) {
  stopHeartbeat();
  model.pingTimer = window.setInterval(() => {
    if (model.ws !== ws) {
      stopHeartbeat();
      return;
    }
    if (ws.readyState !== WebSocket.OPEN) return;
    if (model.pongTimer != null) return;
    try {
      ws.send("ping");
      armPongTimeout(ws);
    } catch {
      ws.close();
    }
  }, 15000);
}

function stopOnline() {
  model.wantSocket = false;
  model.reconnecting = false;
  model.roomCode = "";
  model.reconnectAttempt = 0;
  if (model.reconnectTimer != null) {
    window.clearTimeout(model.reconnectTimer);
    model.reconnectTimer = null;
  }
  stopHeartbeat();
  const ws = model.ws;
  model.ws = null;
  ws?.close();
}

function scheduleReconnect() {
  if (model.reconnectTimer != null || !model.roomCode || !model.wantSocket) return;
  const delay = Math.min(8000, 1000 * 2 ** model.reconnectAttempt);
  model.reconnectAttempt += 1;
  model.reconnectTimer = window.setTimeout(() => {
    model.reconnectTimer = null;
    if (!model.wantSocket || !model.roomCode || model.solo) return;
    openSocket(model.roomCode);
  }, delay);
}

function nudgeReconnect() {
  if (!model.wantSocket || model.solo || !model.roomCode || model.screen !== "table") return;
  const ws = model.ws;
  if (ws && ws.readyState === WebSocket.CONNECTING) return;
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send("ping");
      armPongTimeout(ws);
    } catch {
      ws.close();
    }
    return;
  }
  if (model.reconnectTimer != null) {
    window.clearTimeout(model.reconnectTimer);
    model.reconnectTimer = null;
  }
  model.reconnecting = true;
  openSocket(model.roomCode);
}

function openSocket(code: string) {
  const prev = model.ws;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/ws/${code}`);
  model.ws = ws;
  if (prev && prev.readyState !== WebSocket.CLOSED) prev.close();

  ws.addEventListener("open", () => {
    if (model.ws !== ws) return;
    const returned = model.reconnecting;
    model.reconnecting = false;
    model.reconnectAttempt = 0;
    if (model.reconnectTimer != null) {
      window.clearTimeout(model.reconnectTimer);
      model.reconnectTimer = null;
    }
    startHeartbeat(ws);
    ws.send(
      JSON.stringify({
        type: "hello",
        playerId: model.youId,
        name: model.name.trim() || "Oyuncu",
      } satisfies ClientEvent),
    );
    if (returned) toast("Bağlandı.", true);
  });

  ws.addEventListener("message", (ev) => {
    if (model.ws !== ws) return;
    if (ev.data === "pong") {
      if (model.pongTimer != null) {
        window.clearTimeout(model.pongTimer);
        model.pongTimer = null;
      }
      return;
    }
    try {
      const msg = JSON.parse(String(ev.data)) as { type: string; game?: GameState; youId?: string; message?: string };
      if (msg.type === "error" && msg.message) {
        if (
          msg.message === "El girişi açık değil." ||
          msg.message === "Masada değilsin." ||
          msg.message === "Bu koltuğu sen dolduramazsın." ||
          msg.message === "Geçersiz koltuk."
        ) {
          model.pendingSubmit = null;
        }
        toast(msg.message);
        return;
      }
      if (msg.type === "state" && msg.game) {
        const prevHost = model.game?.hostId ?? "";
        const prevHistory = model.game?.history.length ?? 0;
        const becameHost = prevHost !== "" && msg.game.hostId !== prevHost && msg.game.hostId === model.youId;
        const prev = model.lastPhase;
        model.game = absorbState(msg.game);
        if (msg.game.phase !== "lobby") model.qrOpen = false;
        model.screen = "table";
        model.error = "";
        model.lastPhase = msg.game.phase;
        const me = msg.game.players.find((p) => p.id === model.youId);
        if (me?.seat != null && msg.game.phase !== "scoring") model.formSeat = me.seat;
        if (msg.game.phase === "scoring" && prev !== "scoring") {
          model.formDirty = false;
          if (me?.seat != null) model.formSeat = me.seat;
        }
        if (model.game.phase === "scoring") syncFormFromGame();
        noteTransition(prev, prevHistory, msg.game);
        if (becameHost) toast("Masa sende.", true);
        render();
      }
    } catch {}
  });

  ws.addEventListener("close", () => {
    if (model.ws === ws || model.ws === null) stopHeartbeat();
    if (model.ws !== ws) return;
    model.ws = null;
    if (!model.wantSocket || model.solo || model.screen !== "table") return;
    const first = !model.reconnecting;
    model.reconnecting = true;
    scheduleReconnect();
    if (first) toast("Bağlantı koptu, yeniden bağlanıyor.");
    else render();
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
  stopOnline();
  model.solo = true;
  model.lastPhase = null;
  model.openHand = null;
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
  model.lastPhase = null;
  model.openHand = null;
  model.screen = "table";
  model.game = emptyGame(code);
  model.roomCode = code;
  model.wantSocket = true;
  model.reconnecting = false;
  model.reconnectAttempt = 0;
  if (model.reconnectTimer != null) {
    window.clearTimeout(model.reconnectTimer);
    model.reconnectTimer = null;
  }
  openSocket(code);
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
  if (field === "remaining" || field === "openingValue" || field === "pairCount") {
    touchForm();
    renderKeepingFocus();
  }
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
  if (act === "undo") {
    if (confirm("Son el silinsin mi?")) send({ type: "undo" });
  }
  if (act === "cancel-hand") {
    if (confirm("Bu el yazılmadan kapansın mı?")) send({ type: "cancelHand" });
  }
  if (act === "hand") {
    const i = Number(t.dataset.i);
    model.openHand = model.openHand === i ? null : i;
    render();
  }
  if (act === "reset") {
    if (confirm("Skorlar sıfırlansın mı?")) send({ type: "resetScores" });
  }
  if (act === "qr") {
    model.qrOpen = true;
    render();
  }
  if (act === "qr-close") {
    model.qrOpen = false;
    render();
  }
  if (act === "copy") {
    const url = roomLink(model.game?.code ?? "");
    void navigator.clipboard.writeText(url).then(
      () => toast("Link kopyalandı.", true),
      () => toast(url, true),
    );
  }
  if (act === "form-seat") {
    model.formSeat = Number(t.dataset.seat) as Seat;
    model.formDirty = false;
    syncFormFromGame();
    render();
  }
  if (act === "open") {
    model.form.open = t.dataset.v as OpenKind;
    touchForm();
    render();
  }
  if (act === "okey") {
    const d = Number(t.dataset.d);
    model.form.okeyCount = Math.min(2, Math.max(0, model.form.okeyCount + d));
    touchForm();
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
    touchForm();
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
      touchForm();
      render();
    }
  }
  if (act === "del-chip") {
    const i = Number(t.dataset.i);
    model.form.penalties = model.form.penalties.filter((_, idx) => idx !== i);
    touchForm();
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
    touchForm();
    render();
  }
  if (act === "alip-cancel") {
    model.alip = null;
    render();
  }
  if (act === "submit") {
    if (!model.game) return;
    model.form.seat = model.formSeat;
    if (!model.solo && (!model.ws || model.ws.readyState !== WebSocket.OPEN)) {
      toast(model.reconnecting ? "Yeniden bağlanıyor." : "Bağlantı yok.");
      nudgeReconnect();
      return;
    }
    const result = applyEvent(model.game, model.youId, { type: "submit", entry: model.form });
    if (result.error) {
      toast(result.error);
      return;
    }
    model.game = result.game;
    model.formDirty = false;
    const saved = result.game.current?.[model.formSeat];
    const pending = saved ? cloneEntry(saved) : null;
    model.pendingSubmit = pending;
    syncFormFromGame();
    if (model.solo) {
      model.pendingSubmit = null;
      localStorage.setItem("okey.solo", JSON.stringify(model.game));
      toast("Kaydedildi.", true);
      return;
    }
    if (pending) {
      model.ws?.send(JSON.stringify({ type: "submit", entry: pending } satisfies ClientEvent));
    }
    toast("Kaydedildi.", true);
  }
  if (act === "lock") send({ type: "lock" });
});

function roomLink(code: string): string {
  return `${location.origin}${location.pathname}?oda=${code}`;
}

export function boot() {
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || !model.qrOpen) return;
    model.qrOpen = false;
    render();
  });
  const params = new URLSearchParams(location.search);
  const oda = params.get("oda");
  if (oda) {
    const code = normalizeCode(oda);
    if (code) model.codeInput = code;
  }
  render();
  window.addEventListener("online", nudgeReconnect);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") nudgeReconnect();
  });
  if (oda && model.name) {
    const code = normalizeCode(oda);
    if (code) startOnline(code);
  }
}
