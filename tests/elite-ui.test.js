import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { board as classicBoard, eliteBoard, chance } from "../lib/board.js";
import { figures } from "../lib/figures.js";
import { createGame } from "../lib/game.js";
function ui() {
  const element = { addEventListener() {} };
  const c = vm.createContext({
    classicBoard,
    eliteBoard,
    chance,
    figures,
    document: { querySelector: () => element },
    sessionStorage: { getItem: () => null },
    localStorage: { getItem: () => null },
    location: { protocol: "http:", host: "localhost", search: "" },
    performance: { now: () => 1000 },
    WebSocket: class {},
    URLSearchParams,
  });
  vm.runInContext(
    readFileSync(new URL("../public/app.js", import.meta.url), "utf8").replace(
      /^import .*;\n/gm,
      "",
    ),
    c,
  );
  c.state = {
    code: "TEST",
    name: "Test",
    host: "a",
    chat: [],
    players: [
      { id: "a", name: "Аня", color: 0 },
      { id: "b", name: "Борис", color: 1 },
    ],
    game: createGame(
      [
        { id: "a", name: "Аня", color: 0 },
        { id: "b", name: "Борис", color: 1 },
      ],
      { rules: "elite", shuffle: false },
    ),
  };
  vm.runInContext('room=state;you="a"', c);
  return c;
}
test("NSK renders 40 cells with Fortuna at 15, gold title, currency and bank stock", () => {
  const c = ui();
  const html = vm.runInContext("gameHTML()", c);
  assert.equal((html.match(/class="cell /g) || []).length, 40);
  assert.match(html, /data-cell="14"[^>]*aria-label="Фортуна"/);
  assert.doesNotMatch(html, /Общественная казна|₽/);
  assert.match(html, /board-logo"><span>МИЛЛИОНЕРЫ/);
  assert.match(html, /96<\/b> домов/);
});
test("every new mandatory decision has a usable player control", () => {
  const c = ui();
  const cases = [
    [{ type: "casino", player: "a" }, "casinoSpin"],
    [{ type: "exchange", player: "a", stage: "before" }, "exchangeRoll"],
    [
      { type: "insurance", player: "a", amount: 100, policies: ["blue"] },
      "insuranceUse",
    ],
    [
      { type: "chanceChoice", player: "a", choices: [0, 1, 2] },
      "data-chance-card",
    ],
    [{ type: "randomAuction", player: "a" }, "randomAuction"],
    [{ type: "fortuneSale", player: "a" }, "fortuneAccept"],
    [{ type: "fortuneLoss", player: "a" }, "fortuneAccept"],
    [{ type: "fortuneAuction", player: "a", choices: [5, 15] }, "fortuneIndex"],
    [{ type: "auctionInsurance", player: "a", index: 1 }, "fortuneAccept"],
  ];
  for (const [pending, marker] of cases) {
    c.state.game.pending = pending;
    assert.ok(
      vm
        .runInContext("controls(room.game,room.game.players[0])", c)
        .includes(marker),
      pending.type,
    );
  }
});
