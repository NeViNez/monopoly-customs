import http from "node:http";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { createGame, act } from "./lib/game.js";

export async function createServer({
  dataDir = resolve("data"),
  persist = true,
} = {}) {
  const rooms = new Map(),
    clients = new Map();
  let saveChain = Promise.resolve();
  if (persist) {
    await mkdir(dataDir, { recursive: true });
    try {
      for (const r of JSON.parse(
        await readFile(resolve(dataDir, "rooms.json"), "utf8"),
      ))
        rooms.set(r.code, r);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  const save = () => {
    if (persist) {
      const snapshot = JSON.stringify([...rooms.values()]);
      saveChain = saveChain
        .then(async () => {
          await writeFile(resolve(dataDir, "rooms.tmp"), snapshot);
          await rename(
            resolve(dataDir, "rooms.tmp"),
            resolve(dataDir, "rooms.json"),
          );
        })
        .catch((e) =>
          console.error("Не удалось сохранить комнаты:", e.message),
        );
    }
    return saveChain;
  };
  const send = (ws, value) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(value));
  };
  const online = (code, id) =>
    [...clients.values()].some((c) => c.code === code && c.id === id);
  const view = (r) => ({
    code: r.code,
    name: r.name,
    host: r.host,
    players: r.players.map(({ token, ...p }) => ({
      ...p,
      online: online(r.code, p.id),
    })),
    game: r.game ? { ...r.game, decks: undefined } : null,
    chat: r.chat,
  });
  const listing = () =>
    [...rooms.values()].map((r) => ({
      code: r.code,
      name: r.name,
      count: r.players.length,
      started: !!r.game,
      finished: !!r.game?.winner,
    }));
  const broadcast = () => {
    for (const [ws, c] of clients) {
      const r = rooms.get(c.code);
      send(
        ws,
        r
          ? { type: "room", room: view(r), you: c.id }
          : { type: "rooms", rooms: listing() },
      );
    }
  };
  const root = fileURLToPath(new URL("./public/", import.meta.url));
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405);
        res.end();
        return;
      }
      const files = {
        "/": "index.html",
        "/index.html": "index.html",
        "/app.js": "app.js",
        "/style.css": "style.css",
        "/elite.css": "elite.css",
        "/skyline.svg": "skyline.svg",
        "/board.js": "../lib/board.js",
        "/favicon.svg": "favicon.svg",
      };
      const file = files[url.pathname];
      if (!file) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const body = await readFile(resolve(root, file));
      res.writeHead(200, {
        "Content-Type": {
          ".html": "text/html; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".svg": "image/svg+xml",
        }[extname(file)],
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "same-origin",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(500);
      res.end("Server error");
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    const origin = req.headers.origin;
    const allowed = process.env.PUBLIC_ORIGIN;
    const originHost = (() => {
      try {
        return new URL(origin).host;
      } catch {
        return null;
      }
    })();
    if (
      req.url !== "/ws" ||
      (origin &&
        (allowed ? origin !== allowed : originHost !== req.headers.host))
    ) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  });
  wss.on("connection", (ws) => {
    clients.set(ws, {});
    ws.alive = true;
    ws.on("pong", () => (ws.alive = true));
    send(ws, { type: "rooms", rooms: listing() });
    let windowStart = Date.now(),
      messages = 0;
    ws.on("message", (raw) => {
      try {
        if (Date.now() - windowStart > 1000) {
          windowStart = Date.now();
          messages = 0;
        }
        if (++messages > 30)
          throw Error("Слишком много действий. Подождите секунду.");
        const m = JSON.parse(raw);
        const c = clients.get(ws);
        if (!m || typeof m.type !== "string")
          throw Error("Некорректное сообщение");
        if (m.type === "resume") {
          const r = rooms.get(m.code),
            p = r?.players.find(
              (p) => typeof m.token === "string" && p.token === m.token,
            );
          if (!p) {
            send(ws, { type: "sessionExpired" });
            return;
          }
          for (const [other, session] of clients) {
            if (
              other !== ws &&
              session.code === r.code &&
              session.id === p.id
            ) {
              send(other, { type: "replaced" });
              clients.delete(other);
              other.close();
            }
          }
          clients.set(ws, { code: r.code, id: p.id });
          broadcast();
          return;
        }
        if (m.type === "create" || m.type === "join") {
          if (c.code) throw Error("Сначала выйдите из текущей комнаты");
          if (typeof m.name !== "string") throw Error("Введите никнейм");
          const name = m.name.trim();
          if (!name) throw Error("Введите никнейм");
          let r;
          if (m.type === "create") {
            const code = randomBytes(4).toString("hex").toUpperCase();
            r = {
              code,
              name:
                typeof m.roomName === "string" && m.roomName.trim()
                  ? m.roomName.trim()
                  : `Комната ${name}`,
              players: [],
              host: null,
              game: null,
              chat: [],
            };
            rooms.set(code, r);
          } else {
            r = rooms.get(String(m.code).toUpperCase());
            if (!r) throw Error("Комната не найдена");
            if (r.game)
              throw Error(
                "Игра уже началась. Вернуться можно из прежнего браузера.",
              );
          }
          if (r.players.length >= 8) throw Error("В комнате уже 8 игроков");
          const p = {
            id: randomUUID(),
            token: randomBytes(32).toString("hex"),
            name,
            color: Array.from({ length: 8 }, (_, i) => i).find(
              (i) => !r.players.some((p) => p.color === i),
            ),
          };
          r.players.push(p);
          r.host ??= p.id;
          clients.set(ws, { code: r.code, id: p.id });
          send(ws, { type: "session", code: r.code, token: p.token });
          save();
          broadcast();
          return;
        }
        const r = rooms.get(c.code);
        if (!r) throw Error("Сначала войдите в комнату");
        if (m.type === "leave") {
          if (r.game && !r.game.winner)
            throw Error(
              "Во время игры можно закрыть вкладку и вернуться; место сохраняется.",
            );
          r.players = r.players.filter((p) => p.id !== c.id);
          if (r.host === c.id) r.host = r.players[0]?.id;
          if (!r.players.length) rooms.delete(r.code);
          clients.set(ws, {});
          send(ws, { type: "left" });
        } else if (m.type === "start") {
          if (r.host !== c.id)
            throw Error("Начать игру может создатель комнаты");
          if (r.game) throw Error("Игра уже началась");
          r.game = createGame(r.players.map(({ token, ...p }) => p));
        } else if (m.type === "rematch") {
          if (r.host !== c.id || !r.game?.winner)
            throw Error("Реванш доступен создателю после завершения игры");
          r.game = null;
        } else if (m.type === "chat") {
          if (typeof m.text !== "string" || !m.text.trim()) return;
          const text = m.text.trim().slice(0, 2000);
          r.chat.push({
            name: r.players.find((p) => p.id === c.id).name,
            text,
          });
          r.chat = r.chat.slice(-100);
        } else if (m.type === "action") {
          if (!r.game) throw Error("Игра ещё не началась");
          const draft = structuredClone(r.game);
          act(draft, c.id, m.action);
          r.game = draft;
        } else throw Error("Неизвестная команда");
        save();
        broadcast();
      } catch (e) {
        send(ws, { type: "error", message: e.message });
      }
    });
    ws.on("close", () => {
      clients.delete(ws);
      broadcast();
    });
    ws.on("error", () => {});
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
    }
  }, 30000);
  heartbeat.unref();
  return {
    server,
    rooms,
    async close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      await new Promise((r) => wss.close(r));
      if (server.listening) await new Promise((r) => server.close(r));
      await saveChain;
    },
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = await createServer();
  const port = Number(process.env.PORT || 3000);
  app.server.listen(port, process.env.HOST || "0.0.0.0", () =>
    console.log(`Monopoly: http://localhost:${port}`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      await app.close();
      process.exit(0);
    });
}
