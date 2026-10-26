import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createGame, act } from "../lib/game.js";

test("each accepted roll has a distinct sequence, including identical results", () => {
  const g = createGame([
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ]);
  g.turn = 0;
  assert.equal(g.rollCount, 0);
  assert.throws(() => act(g, "b", { type: "roll" }, () => [1, 1]));
  assert.equal(g.rollCount, 0);
  // Jail allows the same non-double roll on consecutive turns without a purchase.
  g.players[0].jail = true;
  act(g, "a", { type: "roll" }, () => [1, 2]);
  assert.equal(g.rollCount, 1);
  g.phase = "roll";
  act(g, "a", { type: "roll" }, () => [1, 2]);
  assert.equal(g.rollCount, 2);
});

test("dice animate on a new roll, never on reconnect, chat or rematch", () => {
  let now = 1000;
  const element = { addEventListener() {} };
  const context = vm.createContext({
    document: { querySelector: () => element },
    sessionStorage: { getItem: () => null, setItem() {} },
    localStorage: { getItem: () => null, setItem() {} },
    location: { protocol: "http:", host: "localhost" },
    performance: { now: () => now },
    WebSocket: class {},
  });
  const source = readFileSync(
    new URL("../public/app.js", import.meta.url),
    "utf8",
  ).replace(/^import .*;\n/gm, "");
  vm.runInContext(source, context);
  vm.runInContext("render = () => {}; rememberSession = () => {};", context);
  const update = (rollCount) => {
    context.message = {
      type: "room",
      room: { code: "TEST", game: { rollCount } },
    };
    vm.runInContext("ws.onmessage({ data: JSON.stringify(message) })", context);
    return vm.runInContext("diceRollStarted", context);
  };
  assert.equal(update(1), null);
  assert.equal(update(2), 1000);
  now = 1200;
  assert.equal(update(2), 1000);
  assert.equal(update(3), 1200);
  assert.equal(update(0), null);
});
