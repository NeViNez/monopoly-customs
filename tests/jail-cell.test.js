import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { board } from "../lib/board.js";
import { figures } from "../lib/figures.js";
import { createGame } from "../lib/game.js";

test("jail cell separates inmates and visitors, including release without moving", () => {
  const element = { addEventListener() {} };
  const context = vm.createContext({
    board,
    figures,
    document: { querySelector: () => element },
    sessionStorage: { getItem: () => null },
    localStorage: { getItem: () => null },
    location: { protocol: "http:", host: "localhost" },
    performance: { now: () => 1000 },
    WebSocket: class {},
  });
  vm.runInContext(
    readFileSync(new URL("../public/app.js", import.meta.url), "utf8").replace(
      /^import .*;\n/gm,
      "",
    ),
    context,
  );
  context.game = createGame(
    Array.from({ length: 8 }, (_, color) => ({
      id: `p${color}`,
      name: `P${color}`,
      color,
    })),
  );
  for (const [i, p] of context.game.players.entries()) {
    p.position = 10;
    p.jail = i < 4;
  }
  const zones = () => {
    const html = vm.runInContext("boardHTML(game)", context);
    return ["inmates", "visitors"].map(
      (zone) =>
        html.match(
          new RegExp(
            `<span class="jail-zone ${zone}">([\\s\\S]*?)(?=<span class="jail-zone|</button>)`,
          ),
        )?.[1] || "",
    );
  };
  let [inmates, visitors] = zones();
  assert.match(inmates, /Тюрьма/);
  assert.match(visitors, /Посещение/);
  for (let i = 0; i < 8; i++) {
    assert.ok((i < 4 ? inmates : visitors).includes(`data-player="p${i}"`));
    assert.ok(!(i < 4 ? visitors : inmates).includes(`data-player="p${i}"`));
  }
  context.game.players[0].jail = false;
  context.game.players[1].bankrupt = true;
  [inmates, visitors] = zones();
  assert.ok(!inmates.includes('data-player="p0"'));
  assert.ok(visitors.includes('data-player="p0"'));
  assert.ok(!inmates.includes('data-player="p1"'));
  assert.match(vm.runInContext("boardHTML(null, true)", context), /Посещение/);
});
