import { Room } from "./room.ts";

export { Room };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/ws\/([A-Za-z]{4})$/);
    if (match) {
      const upgrade = request.headers.get("Upgrade");
      if (upgrade !== "websocket") {
        return new Response("WebSocket bekleniyor", { status: 426 });
      }
      const code = match[1].toUpperCase();
      const stub = env.ROOMS.getByName(code);
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
