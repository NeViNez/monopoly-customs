import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server.js";
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
