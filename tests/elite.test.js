import test from "node:test";
import assert from "node:assert/strict";
import { createGame, act, rent } from "../lib/game.js";
import { casinoResult, casinoReels } from "../lib/elite.js";
const game = () =>
  createGame(
    [
      { id: "a", name: "Аня" },
      { id: "b", name: "Борис" },
    ],
    { shuffle: false, rules: "elite" },
  );

test("casino uses six original positions per reel and all 216 outcomes", () => {
  assert.deepEqual(casinoReels, [
    ["cherry", "bell", "plum", "cherry", "bell", "seven"],
    ["bell", "seven", "cherry", "plum", "cherry", "plum"],
    ["plum", "cherry", "seven", "cherry", "bell", "bell"],
  ]);
  const counts = {};
  for (let a = 1; a <= 6; a++)
    for (let b = 1; b <= 6; b++)
      for (let c = 1; c <= 6; c++) {
        const r = casinoResult([a, b, c], 250);
        counts[r.kind] = (counts[r.kind] || 0) + 1;
      }
  assert.equal(
    Object.values(counts).reduce((a, b) => a + b),
    216,
  );
  assert.equal(counts.jackpot, 15);
  assert.equal(counts.lose, 78);
  assert.equal(casinoResult([6, 2, 3], 250).payout, 2500);
  assert.equal(casinoResult([6, 2, 1], 250).payout, 250);
  assert.throws(() => casinoResult([0, 2, 3], 250));
});
test("casino is optional, server generated, one attempt per visit and keeps dice independent", () => {
  const g = game();
  g.players[0].position = 17;
  act(g, "a", { type: "roll" }, () => [1, 2]);
  assert.equal(g.pending.type, "casino");
  assert.throws(() => act(g, "b", { type: "casinoSpin" }));
  const money = g.players[0].money;
  const rolls = [
    [6, 2],
    [3, 1],
  ];
  act(g, "a", { type: "casinoSpin" }, () => rolls.shift());
  assert.equal(g.players[0].money, money - 50 + 2500);
  assert.equal(g.casino.pot, 250);
  assert.deepEqual(g.dice, [1, 2]);
  assert.equal(g.rollCount, 1);
  assert.throws(() => act(g, "a", { type: "casinoSpin" }));
  act(g, "a", { type: "ackEvent", eventId: g.event.id });
  act(g, "a", { type: "end" });
});
test("chance event blocks the next roll until acknowledged once by its owner", () => {
  const g = game();
  g.players[0].position = 31;
  g.decks.chance = [7, ...g.decks.chance.filter((i) => i !== 7)];
  act(g, "a", { type: "roll" }, () => [1, 2]);
  assert.equal(g.event.deck, "chance");
  assert.throws(() => act(g, "a", { type: "end" }));
  assert.throws(() => act(g, "b", { type: "ackEvent", eventId: g.event.id }));
  const id = g.event.id;
  act(g, "a", { type: "ackEvent", eventId: id });
  assert.throws(() => act(g, "a", { type: "ackEvent", eventId: id }));
});
test("elite has 40 cells, Fortuna replaces treasury, bank has 96 houses and 24 hotels", () => {
  const g = game();
  assert.equal(g.bank.houses, 96);
  assert.equal(g.bank.hotels, 24);
  assert.equal(g.players[0].money, 2000);
  assert.equal(g.casino.pot, 200);
});

test("Fortuna charges all shareholders once, overrides district rent, and expires with the next card", () => {
  const g = game();
  g.players[0].shares = 2;
  g.players[1].shares = 1;
  g.decks.fortune = [4, 19];
  g.players[0].position = 11;
  act(g, "a", { type: "roll" }, () => [1, 2]);
  assert.equal(g.fortune.cardId, "C1R5");
  assert.equal(g.players[0].money, 1900);
  assert.equal(g.players[1].money, 1900);
  g.properties[21].owner = "b";
  assert.equal(rent(g, 21, 3), 50);
  const restored = JSON.parse(JSON.stringify(g));
  act(restored, "a", { type: "ackEvent", eventId: restored.event.id });
  assert.equal(restored.players[0].money, 1900);
  restored.players[0].position = 11;
  restored.phase = "roll";
  act(restored, "a", { type: "roll" }, () => [1, 2]);
  assert.equal(restored.fortune.cardId, "C4R5");
  assert.equal(rent(restored, 21, 3), 3);
  assert.deepEqual(restored.fortuneDiscard, [4, 19]);
});
test("Fortuna deferred free shares goes to the first exchange visitor, once", () => {
  const g = game();
  g.decks.fortune = [2];
  g.players[0].position = 11;
  act(g, "a", { type: "roll" }, () => [1, 2]);
  act(g, "a", { type: "ackEvent", eventId: g.event.id });
  g.phase = "roll";
  g.players[0].position = 16;
  act(g, "a", { type: "roll" }, () => [1, 2]);
  assert.equal(g.players[0].shares, 48);
  assert.equal(g.market.available, 0);
  assert.equal(g.fortune.onceDone, true);
});
test("normal stock purchase is bounded by money, supply and turn; dividends use current price", () => {
  const g = game();
  assert.throws(() => act(g, "b", { type: "shareBuy", count: 1 }));
  act(g, "a", { type: "shareBuy", count: 3 });
  assert.equal(g.players[0].shares, 3);
  assert.equal(g.players[0].money, 1700);
  assert.throws(() => act(g, "a", { type: "shareBuy", count: -1 }));
  g.players[0].position = 39;
  act(g, "a", { type: "roll" }, () => [1, 1]);
  assert.equal(g.players[0].money, 1960);
});

test("insurance offers a choice before an adverse collective payment and never repeats it", () => {
  const g = game();
  g.players[0].shares = 1;
  act(g, "a", { type: "buyPolicy", policy: "blue" });
  g.decks.fortune = [4];
  g.players[0].position = 11;
  act(g, "a", { type: "roll" }, () => [1, 2]);
  assert.equal(g.players[0].money, 1800);
  act(g, "a", { type: "ackEvent", eventId: g.event.id });
  assert.equal(g.pending.type, "insurance");
  act(g, "a", { type: "insuranceUse", policy: "blue" });
  assert.equal(g.players[0].money, 1800);
  assert.equal(g.fortune.coverage.a.once, true);
  assert.equal(g.fortune.coverage.a.lasting, false);
});
test("crossing the tax inspector settles taxes before landing purchase, exemption is used once", async () => {
  const { propertyTax } = await import("../lib/game.js");
  const g = game();
  g.players[0].shares = 2;
  g.properties[1].owner = "a";
  assert.equal(propertyTax(g, 1), 15);
  g.players[0].position = 8;
  act(g, "a", { type: "roll" }, () => [1, 2]);
  assert.equal(g.players[0].money, 1965);
  assert.equal(g.pending.type, "purchase");
  act(g, "a", { type: "buy" });
  g.players[0].taxExempt = true;
  g.players[0].position = 8;
  g.phase = "roll";
  const before = g.players[0].money;
  act(g, "a", { type: "roll" }, () => [1, 2]);
  assert.equal(g.players[0].money, before);
  assert.equal(g.players[0].taxExempt, false);
});

test("Elite development uses three houses then a hotel and returns the right stock", () => {
  const g = game();
  for (const i of [1, 2, 3])
    g.properties[i] = { owner: "a", level: 3, mortgaged: false };
  g.players[0].money = 500;
  act(g, "a", { type: "build", index: 1 });
  assert.equal(g.properties[1].level, 5);
  assert.equal(g.bank.houses, 99);
  assert.equal(g.bank.hotels, 23);
  act(g, "a", { type: "sell", index: 1 });
  assert.equal(g.properties[1].level, 3);
  assert.equal(g.bank.houses, 96);
  assert.equal(g.bank.hotels, 24);
});
test("third district is granted only from bank", () => {
  const g = game();
  g.decks.fortune = [16];
  g.properties[1].owner = "a";
  g.properties[2].owner = "a";
  g.properties[3].owner = "b";
  g.players[0].position = 11;
  act(g, "a", { type: "roll" }, () => [1, 2]);
  assert.equal(g.properties[3].owner, "b");
});

test("all 20 confirmed Fortuna cards resolve, preserve share supply and survive serialization", () => {
  for (let card = 0; card < 20; card++) {
    let g = game();
    g.players[0].shares = 3;
    g.players[1].shares = 1;
    g.market.available = 44;
    g.players.forEach((p) => (p.money = 10000));
    g.decks.fortune = [card];
    for (const i of [5, 15, 25, 35]) g.properties[i].owner = "a";
    for (const i of [1, 2]) g.properties[i].owner = "b";
    g.players[0].position = 11;
    act(g, "a", { type: "roll" }, () => [1, 2]);
    g = JSON.parse(JSON.stringify(g));
    for (let step = 0; step < 15 && (g.event || g.pending); step++) {
      if (g.event)
        act(g, g.event.player, { type: "ackEvent", eventId: g.event.id });
      else if (g.pending.type === "insurance")
        act(g, g.pending.player, { type: "insuranceDecline" });
      else if (g.pending.type === "fortuneSale")
        act(g, g.pending.player, { type: "fortuneAccept", count: 1 });
      else if (g.pending.type === "fortuneLoss")
        act(g, g.pending.player, { type: "fortuneAccept" });
      else if (g.pending.type === "fortuneAuction")
        act(g, g.pending.player, {
          type: "fortuneAccept",
          index: g.pending.choices[0],
        });
      else if (g.pending.type === "auction") {
        const q = g.players.find(
          (p) => p.id !== g.pending.leader && !g.pending.passed.includes(p.id),
        );
        act(g, q.id, { type: "pass" });
      } else
        assert.fail(`Unexpected decision ${g.pending.type} on card ${card}`);
    }
    assert.equal(g.event, null, `card ${card}`);
    assert.equal(g.pending, null, `card ${card}`);
    assert.equal(
      g.players.reduce((sum, p) => sum + p.shares, g.market.available),
      48,
      `card ${card}`,
    );
    assert.ok(
      g.players.every((p) => Number.isSafeInteger(p.money) && p.money >= 0),
      `card ${card}`,
    );
  }
});

test("Fortuna support moves one loaned red policy and cannot reissue it after use", () => {
  const g = game();
  g.decks.fortune = [1];
  g.players[0].position = 11;
  act(g, "a", { type: "roll" }, () => [1, 2]);
  assert.equal(g.players[0].freeRed, true);
  assert.equal(g.insurance.red, 11);
  act(g, "a", { type: "ackEvent", eventId: g.event.id });
  act(g, "a", { type: "protectFortune", policy: "red" });
  assert.equal(g.players[0].freeRed, false);
  assert.equal(g.insurance.red, 12);
});
test("chosen three-card Chance returns two unused cards and applies only the chosen one", () => {
  const g = game();
  g.decks.fortune = [11];
  g.players[0].position = 11;
  act(g, "a", { type: "roll" }, () => [1, 2]);
  act(g, "a", { type: "ackEvent", eventId: g.event.id });
  g.players[0].position = 1;
  g.phase = "roll";
  g.decks.chance = [
    7,
    11,
    12,
    ...g.decks.chance.filter((i) => ![7, 11, 12].includes(i)),
  ];
  act(g, "a", { type: "roll" }, () => [1, 2]);
  assert.equal(g.pending.type, "chanceChoice");
  const before = g.players[0].money;
  act(g, "a", { type: "chanceChoose", index: 7 });
  assert.equal(g.players[0].money, before + 50);
  assert.equal(g.decks.chance.length, 16);
});
test("six casino rolls choose the highest single payout, and jackpot empties the pot", () => {
  const g = game();
  g.decks.fortune = [8];
  g.players[0].position = 11;
  act(g, "a", { type: "roll" }, () => [1, 2]);
  act(g, "a", { type: "ackEvent", eventId: g.event.id });
  g.players[0].position = 17;
  g.phase = "roll";
  act(g, "a", { type: "roll" }, () => [1, 2]);
  assert.equal(g.pending.six, true);
  const rolls = [
    [6, 1],
    [2, 1],
    [3, 1],
  ];
  act(g, "a", { type: "casinoSpin" }, () => rolls.shift());
  assert.equal(g.event.result.payout, 2500);
  const h = game();
  h.players[0].position = 17;
  act(h, "a", { type: "roll" }, () => [1, 2]);
  const resultRolls = [
    [6, 2],
    [1, 1],
  ];
  act(h, "a", { type: "casinoSpin" }, () => resultRolls.shift());
  assert.equal(h.event.result.kind, "jackpot");
  assert.equal(h.casino.pot, 0);
});

test("third double sends player to inspection and settles the round tax immediately", () => {
  const g = game();
  g.players[0].shares = 1;
  g.players[0].position = 36;
  g.doubles = 2;
  act(g, "a", { type: "roll" }, () => [1, 1]);
  assert.equal(g.players[0].position, 10);
  assert.equal(g.players[0].jail, true);
  assert.equal(g.players[0].money, 1990);
  assert.equal(g.queue.length, 0);
});
