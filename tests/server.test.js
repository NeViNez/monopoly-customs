import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server.js";
import { createGame, act } from "../lib/game.js";
async function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const queue = [];
  let changed;
  ws.on("message", (raw) => {
    queue.push(JSON.parse(raw));
    changed?.();
  });
  await new Promise((r, j) => {
    ws.once("open", r);
    ws.once("error", j);
  });
  return {
    ws,
    send: (m) => ws.send(JSON.stringify(m)),
    async get(type, predicate = () => true) {
      const end = Date.now() + 3000;
      while (Date.now() < end) {
        const i = queue.findIndex((m) => m.type === type && predicate(m));
        if (i >= 0) return queue.splice(i, 1)[0];
        await new Promise((r) => {
          const timer = setTimeout(r, 30);
          changed = () => {
            clearTimeout(timer);
            r();
          };
        });
      }
      throw Error(`Timeout: ${type}`);
    },
  };
}
test("autoplay completes purchases and keeps playing later turns without toggling", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "monopoly-autoplay-"));
  const app = await createServer({ dataDir });
  t.after(async () => {
    if (app.server.listening) await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const port = app.server.address().port;
  const a = await client(port),
    b = await client(port);
  a.send({ type: "create", name: "Автопилот" });
  const { code } = await a.get("session");
  const { you: aid } = await a.get("room");
  b.send({ type: "join", name: "Соперник", code });
  const { you: bid } = await b.get("room");
  const room = app.rooms.get(code);
  room.game = createGame(room.players, { shuffle: false });
  act(room.game, aid, { type: "roll" }, () => [1, 2]);

  a.send({ type: "autoplay", enabled: true });
  const first = (await a.get("room", (m) => !!m.room.game)).room.game;
  assert.equal(first.properties[3].owner, aid);
  assert.equal(first.pending, null);
  assert.equal(
    first.players[first.turn].id,
    bid,
    "autoplay must finish the whole turn",
  );

  // A jailed player gets one roll regardless of doubles, keeping this check deterministic.
  room.game.players[0].jail = true;
  room.game.players[0].position = 10;
  room.game.phase = "end";
  b.send({ type: "action", action: { type: "end" } });
  const second = (
    await a.get("room", (m) => m.room.game?.rollCount > first.rollCount)
  ).room.game;
  assert.equal(second.players[second.turn].id, bid);
  assert.equal(second.pending, null);
  assert.equal(second.players[0].autoplay, true);

  // Two autopilots must continue after the server's per-batch action limit.
  for (const p of room.game.players) p.money = 100000;
  b.send({ type: "autoplay", enabled: true });
  const batch = (await a.get("room", (m) => m.room.game?.players[1].autoplay))
    .room.game;
  const continued = (
    await a.get("room", (m) => m.room.game?.rollCount > batch.rollCount)
  ).room.game;
  assert.ok(continued.rollCount > batch.rollCount);

  a.send({ type: "autoplay", enabled: false });
  b.send({ type: "autoplay", enabled: false });
  const stopped = (
    await a.get("room", (m) => m.room.game?.players.every((p) => !p.autoplay))
  ).room.game;
  await app.close();
  const [saved] = JSON.parse(
    await readFile(join(dataDir, "rooms.json"), "utf8"),
  );
  const { decks, ...savedGame } = saved.game;
  assert.deepEqual(savedGame, stopped);
});

test("two clients share game, reject forged turns, reconnect and restore after restart", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "monopoly-test-"));
  let app = await createServer({ dataDir });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  let port = app.server.address().port;
  let a = await client(port),
    b = await client(port);
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  a.send({ type: "create", name: "Одинаковый ник" });
  const session = await a.get("session");
  const first = await a.get("room");
  assert.equal(first.room.players[0].name, "Одинаковый ник");
  assert.equal(JSON.stringify(first).includes("token"), false);
  b.send({ type: "join", name: "Одинаковый ник", code: session.code });
  const br = await b.get("room");
  assert.equal(br.room.players.length, 2);
  assert.notEqual(br.you, first.you);
  b.send({ type: "figure", figure: 6 });
  const chosen = await b.get(
    "room",
    (m) => m.room.players.find((p) => p.id === br.you)?.figure === 6,
  );
  assert.equal(
    chosen.room.players.find((p) => p.id === first.you).figure,
    undefined,
  );
  b.send({ type: "figure", figure: -1 });
  assert.match((await b.get("error")).message, /фигурк/);
  b.send({ type: "figure", figure: 1.5 });
  assert.match((await b.get("error")).message, /фигурк/);
  b.send({ type: "start" });
  assert.match((await b.get("error")).message, /создатель/);
  a.send({ type: "start" });
  const started = await a.get("room", (m) => !!m.room.game);
  assert.equal(started.room.game.players.length, 2);
  assert.equal(
    started.room.game.players.find((p) => p.id === br.you).figure,
    6,
  );
  b.send({ type: "figure", figure: 9 });
  assert.match((await b.get("error")).message, /начала/);
  assert.equal(started.room.game.decks, undefined);
  const current =
      started.room.game.players[started.room.game.turn].id === first.you
        ? a
        : b,
    other = current === a ? b : a;
  other.send({ type: "action", action: { type: "roll" } });
  assert.match((await other.get("error")).message, /другого/);
  current.send({ type: "action", action: { type: "roll" } });
  const rolled = await b.get("room", (m) =>
    m.room.game?.log.some((x) => x.includes("бросает")),
  );
  assert.equal(rolled.room.game.dice.length, 2);
  a.ws.close();
  a = await client(port);
  a.send({ type: "resume", code: session.code, token: session.token });
  const resumed = await a.get("room");
  assert.equal(resumed.you, first.you);
  assert.deepEqual(resumed.room.game.dice, rolled.room.game.dice);
  await app.close();
  app = await createServer({ dataDir });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  port = app.server.address().port;
  a = await client(port);
  a.send({ type: "resume", code: session.code, token: session.token });
  const restored = await a.get("room");
  assert.deepEqual(restored.room.game, { ...resumed.room.game });
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal(
    (await fetch(`http://127.0.0.1:${port}/data/rooms.json`)).status,
    404,
  );
});

test("player figure images are served as PNG", async (t) => {
  const app = await createServer({ persist: false });
  t.after(() => app.close());
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const { figures } = await import("../lib/figures.js");
  for (const figure of figures) {
    const response = await fetch(
      `http://127.0.0.1:${app.server.address().port}${figure.image}`,
    );
    assert.equal(response.status, 200, figure.name);
    assert.equal(response.headers.get("content-type"), "image/png");
  }
});

test("Elite party persists an open Fortuna, hides deck order and resumes without charging twice", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "monopoly-elite-"));
  let app = await createServer({ dataDir });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  let a = await client(app.server.address().port),
    b = await client(app.server.address().port);
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  a.send({ type: "create", name: "Аня" });
  const session = await a.get("session");
  const first = await a.get("room");
  b.send({ type: "join", name: "Борис", code: first.room.code });
  await b.get("session");
  await b.get("room");
  a.send({ type: "start" });
  const started = await a.get("room", (m) => !!m.room.game);
  assert.equal(started.room.game.rules, "elite");
  assert.equal(started.room.game.decks, undefined);
  const r = app.rooms.get(first.room.code);
  r.game = createGame(
    r.players.map(({ token, ...p }) => p),
    { rules: "elite", shuffle: false },
  );
  const host = r.game.players[0].id;
  r.game.players[0].position = 11;
  r.game.players[0].shares = 2;
  r.game.players[1].shares = 1;
  r.game.market.available = 45;
  r.game.properties[21].owner = r.game.players[1].id;
  r.game.decks.fortune = [4];
  act(r.game, host, { type: "roll" }, () => [1, 2]);
  a.send({ type: "chat", text: "Сохранить карту" });
  const opened = await a.get(
    "room",
    (m) => m.room.game?.event?.deck === "fortune",
  );
  assert.equal(opened.room.game.quotes[21].rent, 50);
  b.send({
    type: "action",
    action: { type: "ackEvent", eventId: opened.room.game.event.id },
  });
  await b.get("error");
  await app.close();
  app = await createServer({ dataDir });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  a = await client(app.server.address().port);
  a.send({ type: "resume", code: session.code, token: session.token });
  const restored = await a.get("room");
  assert.equal(restored.room.game.fortune.cardId, "C1R5");
  assert.equal(restored.room.game.players[0].money, 1900);
  a.send({
    type: "action",
    action: { type: "ackEvent", eventId: restored.room.game.event.id },
  });
  const accepted = await a.get("room", (m) => m.room.game.event === null);
  assert.equal(accepted.room.game.players[0].money, 1900);
  assert.equal(accepted.room.game.fortune.cardId, "C1R5");
});

test("Elite autoplay leaves one roll visible and chat does not bypass the movement delay", async (t) => {
  const app = await createServer({ persist: false });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  t.after(() => app.close());
  const a = await client(app.server.address().port),
    b = await client(app.server.address().port);
  a.send({ type: "create", name: "Аня" });
  await a.get("session");
  const first = await a.get("room");
  b.send({ type: "join", name: "Борис", code: first.room.code });
  await b.get("session");
  await b.get("room");
  const r = app.rooms.get(first.room.code);
  r.game = createGame(
    r.players.map(({ token, ...p }) => p),
    { rules: "elite", shuffle: false },
  );
  a.send({ type: "autoplay", enabled: true });
  const rolled = await a.get("room", (m) => m.room.game?.rollCount === 1);
  a.send({ type: "chat", text: "Не ускорять анимацию" });
  const afterChat = await a.get("room", (m) =>
    m.room.chat.some((x) => x.text === "Не ускорять анимацию"),
  );
  assert.equal(afterChat.room.game.rollCount, 1);
  assert.deepEqual(afterChat.room.game.movement, rolled.room.game.movement);
});
