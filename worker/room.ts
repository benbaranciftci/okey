import { DurableObject } from "cloudflare:workers";
import { applyEvent, handoffHost } from "../shared/engine.ts";
import { emptyGame, type ClientEvent, type GameState } from "../shared/types.ts";

const HOST_HANDOFF_MS = 15_000;

type Session = { playerId: string };

function parseEvent(raw: string): ClientEvent | null {
  try {
    const data = JSON.parse(raw) as ClientEvent;
    if (!data || typeof data !== "object" || typeof data.type !== "string") return null;
    return data;
  } catch {
    return null;
  }
}

export class Room extends DurableObject<Env> {
  game: GameState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.game = (await this.ctx.storage.get<GameState>("game")) ?? null;
    });
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = url.pathname.split("/").pop()?.toUpperCase() ?? "";
    if (!this.game) {
      this.game = emptyGame(code);
      await this.ctx.storage.put("game", this.game);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: "" } satisfies Session);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;
    if (message === "ping") {
      try {
        ws.send("pong");
      } catch {}
      return;
    }
    const event = parseEvent(message);
    if (!event) {
      ws.send(JSON.stringify({ type: "error", message: "Bozuk mesaj." }));
      return;
    }
    if (message.length > 8000) {
      ws.send(JSON.stringify({ type: "error", message: "Mesaj çok büyük." }));
      return;
    }

    if (!this.game) this.game = emptyGame("XXXX");

    let actorId = (ws.deserializeAttachment() as Session | null)?.playerId || "";
    if (event.type === "hello") {
      actorId = event.playerId.slice(0, 64);
      ws.serializeAttachment({ playerId: actorId } satisfies Session);
    }
    if (!actorId) {
      ws.send(JSON.stringify({ type: "error", message: "Önce isimle gir." }));
      return;
    }

    const result = applyEvent(this.game, actorId, event);
    this.game = result.game;
    if (event.type === "hello") {
      this.game = {
        ...this.game,
        players: this.game.players.map((p) =>
          p.id === actorId ? { ...p, connected: true } : p,
        ),
      };
      if (actorId === this.game.hostId) await this.ctx.storage.deleteAlarm();
    }
    await this.ctx.storage.put("game", this.game);

    if (result.error) {
      ws.send(JSON.stringify({ type: "error", message: result.error }));
    }
    this.broadcast();
  }

  async webSocketClose(ws: WebSocket) {
    await this.dropPlayer(ws);
  }

  async webSocketError(ws: WebSocket) {
    try {
      ws.close();
    } catch {
      await this.dropPlayer(ws);
    }
  }

  async alarm() {
    if (!this.game) return;
    const next = handoffHost(this.game);
    if (next === this.game) return;
    this.game = next;
    await this.ctx.storage.put("game", this.game);
    this.broadcast();
  }

  playerStillHere(playerId: string, except: WebSocket): boolean {
    return this.ctx.getWebSockets().some((socket) => {
      if (socket === except) return false;
      const session = socket.deserializeAttachment() as Session | null;
      return session?.playerId === playerId;
    });
  }

  async dropPlayer(ws: WebSocket) {
    const session = ws.deserializeAttachment() as Session | null;
    const playerId = session?.playerId;
    if (!playerId || !this.game) return;
    if (this.playerStillHere(playerId, ws)) return;
    const player = this.game.players.find((p) => p.id === playerId);
    if (!player || player.guest || !player.connected) return;
    const wasHost = this.game.hostId === playerId;
    this.game = {
      ...this.game,
      players: this.game.players.map((p) =>
        p.id === playerId ? { ...p, connected: false } : p,
      ),
    };
    await this.ctx.storage.put("game", this.game);
    const someoneElse = this.game.players.some((p) => !p.guest && p.connected);
    if (wasHost && someoneElse) {
      await this.ctx.storage.setAlarm(Date.now() + HOST_HANDOFF_MS);
    }
    this.broadcast();
  }

  broadcast() {
    if (!this.game) return;
    for (const socket of this.ctx.getWebSockets()) {
      const session = socket.deserializeAttachment() as Session | null;
      const youId = session?.playerId || "";
      try {
        socket.send(JSON.stringify({ type: "state", game: this.game, youId }));
      } catch {}
    }
  }
}
