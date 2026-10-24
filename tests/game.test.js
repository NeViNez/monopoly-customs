import test from "node:test";
import assert from "node:assert/strict";
import { createGame, act, rent, board } from "../lib/game.js";
const game = () =>
  createGame(
    [
      { id: "a", name: "Аня" },
      { id: "b", name: "Борис" },
    ],
    { shuffle: false },
  );

test("mortgage repayment uses exact percentage arithmetic without floating-point overcharge", () => {
  const g = game();
  g.properties[6] = { owner: "a", level: 0, mortgaged: true };
  act(g, "a", { type: "unmortgage", index: 6 });
  assert.equal(g.players[0].money, 1445);
});
test("classic board and starting balances", () => {
  const g = game();
  assert.equal(board.length, 40);
  assert.equal(g.players[0].money, 1500);
  assert.equal(g.bank.houses, 32);
  assert.equal(g.bank.hotels, 12);
});
test("only current player rolls; salary at GO; buying", () => {
  const g = game();
  assert.throws(() => act(g, "b", { type: "roll" }, () => [1, 2]));
  g.players[0].position = 39;
  act(g, "a", { type: "roll" }, () => [1, 1]);
  assert.equal(g.players[0].money, 1700);
  act(g, "a", { type: "buy" });
  assert.equal(g.properties[1].owner, "a");
  assert.equal(g.players[0].money, 1640);
});
test("declining purchase auctions to all players including decliner", () => {
  const g = game();
  act(g, "a", { type: "roll" }, () => [1, 2]);
  act(g, "a", { type: "auction" });
  act(g, "a", { type: "bid", amount: 10 });
  act(g, "b", { type: "pass" });
  assert.equal(g.properties[3].owner, "a");
  assert.equal(g.players[0].money, 1490);
});
test("monopoly doubles bare rent; mortgaged property charges nothing", () => {
  const g = game();
  g.properties[1].owner = "a";
  g.properties[3].owner = "a";
  assert.equal(rent(g, 1, 7), 4);
  g.properties[1].mortgaged = true;
  assert.equal(rent(g, 1, 7), 0);
});
test("building requires complete group and even development", () => {
  const g = game();
  g.properties[1].owner = "a";
  assert.throws(() => act(g, "a", { type: "build", index: 1 }));
  g.properties[3].owner = "a";
  act(g, "a", { type: "build", index: 1 });
  assert.equal(g.bank.houses, 31);
  assert.throws(() => act(g, "a", { type: "build", index: 1 }));
  assert.throws(() => act(g, "a", { type: "mortgage", index: 3 }));
});
test("three doubles go directly to jail without passing GO", () => {
  const g = game();
  g.players[0].position = 10;
  for (let n = 0; n < 3; n++) {
    act(g, "a", { type: "roll" }, () => [2, 2]);
    if (g.pending?.type === "purchase") act(g, "a", { type: "buy" });
  }
  assert.equal(g.players[0].jail, true);
  assert.equal(g.players[0].position, 10);
  assert.equal(g.phase, "end");
});
test("rent debt waits for liquidation and resumes after mortgage", () => {
  const g = game();
  g.properties[3].owner = "b";
  g.properties[1].owner = "a";
  g.players[0].money = 0;
  act(g, "a", { type: "roll" }, () => [1, 2]);
  assert.equal(g.pending.type, "debt");
  assert.throws(() => act(g, "a", { type: "end" }));
  act(g, "a", { type: "mortgage", index: 1 });
  assert.equal(g.players[0].money, 26);
  assert.equal(g.players[1].money, 1504);
  assert.equal(g.pending, null);
});
test("bankruptcy to player transfers estate and ends game", () => {
  const g = game();
  g.properties[39].owner = "b";
  g.properties[39].level = 5;
  g.players[0].position = 36;
  g.players[0].money = 0;
  act(g, "a", { type: "roll" }, () => [1, 2]);
  act(g, "a", { type: "bankrupt" });
  assert.equal(g.winner, "b");
});
test("free parking pays nothing", () => {
  const g = game();
  g.players[0].position = 17;
  act(g, "a", { type: "roll" }, () => [1, 2]);
  assert.equal(g.players[0].money, 1500);
});
test("jail doubles release without extra roll", () => {
  const g = game();
  g.players[0].jail = true;
  g.players[0].position = 10;
  act(g, "a", { type: "roll" }, () => [1, 1]);
  act(g, "a", { type: "buy" });
  assert.equal(g.players[0].jail, false);
  assert.equal(g.phase, "end");
});
test("new mortgage owner may redeem immediately without paying interest twice", () => {
  const g = game();
  g.properties[1] = { owner: "a", level: 0, mortgaged: true };
  act(g, "a", { type: "offer", to: "b", give: [1] });
  act(g, "b", { type: "acceptTrade" });
  assert.equal(g.pending.type, "mortgageTransfer");
  act(g, "b", { type: "mortgageChoice", redeem: true });
  assert.equal(g.players[1].money, 1467);
  assert.equal(g.properties[1].mortgaged, false);
  assert.equal(g.phase, "roll");
});
test("new owner may keep mortgage then pay interest again on later redemption", () => {
  const g = game();
  g.properties[1] = { owner: "a", level: 0, mortgaged: true };
  act(g, "a", { type: "offer", to: "b", give: [1] });
  act(g, "b", { type: "acceptTrade" });
  act(g, "b", { type: "mortgageChoice", redeem: false });
  assert.equal(g.players[1].money, 1497);
  act(g, "b", { type: "unmortgage", index: 1 });
  assert.equal(g.players[1].money, 1464);
});
test("last building offers other eligible players a competing purchase", () => {
  const g = game();
  for (const i of [1, 3]) g.properties[i].owner = "a";
  for (const i of [6, 8, 9]) g.properties[i].owner = "b";
  g.bank.houses = 1;
  act(g, "a", { type: "build", index: 1 });
  assert.equal(g.pending.type, "buildingRequest");
  act(g, "b", { type: "buildingClaim", index: 6 });
  assert.equal(g.pending.type, "buildingAuction");
  act(g, "a", { type: "bid", amount: 10 });
  act(g, "b", { type: "bid", amount: 11 });
  act(g, "a", { type: "pass" });
  assert.equal(g.properties[6].level, 1);
  assert.equal(g.bank.houses, 0);
  assert.equal(g.players[1].money, 1489);
  assert.equal(g.phase, "roll");
});
test("uncontested last building costs normal price", () => {
  const g = game();
  for (const i of [1, 3]) g.properties[i].owner = "a";
  for (const i of [6, 8, 9]) g.properties[i].owner = "b";
  g.bank.houses = 1;
  act(g, "a", { type: "build", index: 1 });
  act(g, "b", { type: "buildingDecline" });
  assert.equal(g.properties[1].level, 1);
  assert.equal(g.players[0].money, 1450);
});
test("cannot declare bankruptcy while estate can cover debt", () => {
  const g = game();
  g.players[0].money = 0;
  g.properties[1].owner = "a";
  g.properties[3].owner = "b";
  act(g, "a", { type: "roll" }, () => [1, 2]);
  assert.throws(() => act(g, "a", { type: "bankrupt" }), /погасить/);
});
test("third failed jail roll pays then moves, even after debt liquidation", () => {
  const g = game();
  const p = g.players[0];
  p.jail = true;
  p.position = 10;
  p.jailTurns = 2;
  p.money = 0;
  g.properties[39].owner = "a";
  act(g, "a", { type: "roll" }, () => [1, 2]);
  assert.equal(g.pending.type, "debt");
  act(g, "a", { type: "mortgage", index: 39 });
  assert.equal(p.position, 13);
  assert.equal(p.jail, false);
  assert.equal(p.money, 150);
  assert.equal(g.pending.type, "purchase");
  act(g, "a", { type: "buy" });
  assert.equal(g.phase, "end");
});
test("bankruptcy of birthday payer does not consume active player turn or extra roll", () => {
  const g = createGame(
    [
      { id: "a", name: "А" },
      { id: "b", name: "Б" },
      { id: "c", name: "В" },
    ],
    { shuffle: false },
  );
  g.decks.chest = [8, ...g.decks.chest.filter((i) => i !== 8)];
  g.players[1].money = 0;
  act(g, "a", { type: "roll" }, () => [1, 1]);
  assert.equal(g.pending.from, "b");
  act(g, "b", { type: "bankrupt" });
  assert.equal(g.turn, 0);
  assert.equal(g.phase, "roll");
  assert.equal(g.players[0].money, 1510);
});
test("highest starting roll begins; ties reroll only tied players", () => {
  const rolls = [
    [1, 2],
    [2, 1],
    [1, 1],
    [6, 6],
  ];
  const g = createGame(
    [
      { id: "a", name: "А" },
      { id: "b", name: "Б" },
    ],
    { startingRoll: () => rolls.shift() },
  );
  assert.equal(g.turn, 1);
  assert.equal(g.players[1].position, 0);
  assert.equal(g.players[1].money, 1500);
  assert.ok(g.log.some((x) => x.includes("12")));
});
test("all 32 cards resolve and preserve deck size unless held", () => {
  for (const deck of ["chance", "chest"])
    for (let i = 0; i < 16; i++) {
      const g = game();
      g.decks[deck] = [i, ...g.decks[deck].filter((j) => j !== i)];
      g.players[0].position = deck === "chance" ? 4 : 14;
      act(g, "a", { type: "roll" }, () => [1, 2]);
      assert.ok(g.lastCard?.text);
      assert.equal(g.decks[deck].length + g.players[0].cards.length, 16);
      assert.ok(g.players[0].money >= 0);
    }
});
test("hotel conversion returns four houses; sale returns hotel and takes four houses", () => {
  const g = game();
  for (const i of [1, 3])
    g.properties[i] = { owner: "a", level: 4, mortgaged: false };
  g.bank.houses = 24;
  act(g, "a", { type: "build", index: 1 });
  assert.equal(g.bank.houses, 28);
  assert.equal(g.bank.hotels, 11);
  act(g, "a", { type: "sell", index: 1 });
  assert.equal(g.bank.houses, 24);
  assert.equal(g.bank.hotels, 12);
  assert.equal(g.players[0].money, 1475);
});
test("railroads and utilities count mortgaged siblings", () => {
  const g = game();
  for (const i of [5, 15, 25, 35]) g.properties[i].owner = "a";
  g.properties[15].mortgaged = true;
  assert.equal(rent(g, 5, 7), 200);
  assert.equal(rent(g, 5, 7, "rail"), 400);
  for (const i of [12, 28]) g.properties[i].owner = "a";
  g.properties[28].mortgaged = true;
  assert.equal(rent(g, 12, 7), 70);
});
test("bank bankruptcy cancels mortgages and auctions estate before next turn", () => {
  const g = createGame(
    [
      { id: "a", name: "А" },
      { id: "b", name: "Б" },
      { id: "c", name: "В" },
    ],
    { shuffle: false },
  );
  g.players[0].position = 1;
  g.players[0].money = 0;
  g.properties[1] = { owner: "a", level: 0, mortgaged: true };
  act(g, "a", { type: "roll" }, () => [1, 2]);
  act(g, "a", { type: "bankrupt" });
  assert.equal(g.pending.type, "auction");
  assert.equal(g.properties[1].mortgaged, false);
  act(g, "b", { type: "bid", amount: 10 });
  act(g, "c", { type: "pass" });
  assert.equal(g.turn, 1);
  assert.equal(g.phase, "roll");
  assert.equal(g.properties[1].owner, "b");
});
test("player may mortgage an existing property to afford a purchase", () => {
  const g = game();
  g.properties[39].owner = "a";
  g.players[0].money = 0;
  act(g, "a", { type: "roll" }, () => [1, 2]);
  act(g, "a", { type: "mortgage", index: 39 });
  assert.equal(g.pending.type, "purchase");
  act(g, "a", { type: "buy" });
  assert.equal(g.players[0].money, 140);
});
test("auction participants can raise money by mortgage without losing the auction", () => {
  const g = game();
  g.properties[39].owner = "b";
  g.players[1].money = 0;
  act(g, "a", { type: "roll" }, () => [1, 2]);
  act(g, "a", { type: "auction" });
  act(g, "b", { type: "mortgage", index: 39 });
  act(g, "b", { type: "bid", amount: 200 });
  act(g, "a", { type: "pass" });
  assert.equal(g.properties[3].owner, "b");
  assert.equal(g.players[1].money, 0);
});
