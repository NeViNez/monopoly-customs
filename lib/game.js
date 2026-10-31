import { randomInt } from "node:crypto";
import { board, eliteBoard, gameBoard, chance, chest } from "./board.js";
export { board, gameBoard };
import { casinoResult, casinoStake } from "./elite.js";
import { fortuneCards, fortuneRules, affected, sharePrice } from "./fortune.js";
const fail = (condition, message) => {
  if (!condition) throw Error(message);
};
const player = (g, id) => g.players.find((p) => p.id === id);
const active = (g) => g.players[g.turn];
const houseLimit = (g) => (g.rules === "elite" ? 3 : 4);
const buildingValue = (g, b, s) =>
  (s.level === 5 ? houseLimit(g) + 1 : s.level) * (b.house || 0);
const group = (g, i) =>
  gameBoard(g)
    .filter((b) => b.type === "street" && b.group === gameBoard(g)[i].group)
    .map((b) => b.index);
const owned = (g, id) =>
  gameBoard(g).filter((b) => g.properties[b.index]?.owner === id);
const whole = (g, id, i) =>
  group(g, i).every(
    (j) =>
      g.properties[j].owner === id &&
      (g.rules !== "elite" || !g.properties[j].mortgaged),
  );
const log = (g, text) => {
  g.log.push(text);
  g.log = g.log.slice(-120);
};
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
export function createGame(players, options = {}) {
  fail(players.length >= 2 && players.length <= 8, "Нужно от 2 до 8 игроков");
  const elite = options.rules === "elite";
  const cells = elite ? eliteBoard : board;
  const g = {
    ...(elite ? { rules: "elite" } : {}),
    players: players.map((p) => ({
      ...p,
      money: elite ? 2000 : 1500,
      position: 0,
      jail: false,
      jailTurns: 0,
      cards: [],
      bankrupt: false,
      ...(elite
        ? { shares: 0, policies: [], taxExempt: false, freeHouses: 0 }
        : {}),
    })),
    turn: 0,
    phase: "roll",
    doubles: 0,
    extra: false,
    dice: [1, 1],
    rollCount: 0,
    properties: Object.fromEntries(
      cells
        .filter((b) => b.price)
        .map((b) => [b.index, { owner: null, level: 0, mortgaged: false }]),
    ),
    bank: { houses: elite ? 96 : 32, hotels: elite ? 24 : 12 },
    ...(elite
      ? {
          casino: { pot: 200 },
          eventSequence: 0,
          market: { price: 100, available: 48 },
          insurance: { green: 12, blue: 12, orange: 12, red: 12 },
          fortuneDiscard: [],
        }
      : {}),
    pending: null,
    queue: [],
    auctionQueue: [],
    trade: null,
    decks: Object.fromEntries(
      ["chance", "chest"].map((k) => [
        k,
        options.shuffle === false
          ? Array.from({ length: 16 }, (_, i) => i)
          : shuffle(Array.from({ length: 16 }, (_, i) => i)),
      ]),
    ),
    log: [`Игра началась. Каждый получает ${elite ? 2000 : 1500} фантов.`],
    winner: null,
  };
  if (elite)
    g.decks.fortune =
      options.shuffle === false
        ? fortuneCards.map((_, i) => i)
        : shuffle(fortuneCards.map((_, i) => i));
  if (options.shuffle !== false) {
    let candidates = players.map((_, i) => i);
    const roll =
      options.startingRoll ?? (() => [randomInt(1, 7), randomInt(1, 7)]);
    while (candidates.length > 1) {
      const results = candidates.map((i) => {
        const dice = roll(),
          sum = dice[0] + dice[1];
        log(g, `Жеребьёвка: ${players[i].name} — ${sum}.`);
        return { i, sum };
      });
      const highest = Math.max(...results.map((x) => x.sum));
      candidates = results.filter((x) => x.sum === highest).map((x) => x.i);
    }
    g.turn = candidates[0];
    log(g, `Первым ходит ${active(g).name}.`);
  }
  return g;
}
export function rent(g, i, dice, modifier, payerId) {
  const b = gameBoard(g)[i],
    s = g.properties[i];
  if (!s?.owner || s.mortgaged) return 0;
  const count = owned(g, s.owner).filter((x) => x.type === b.type).length;
  const base =
    b.type === "street"
      ? b.rents[s.level] * (s.level === 0 && whole(g, s.owner, i) ? 2 : 1)
      : b.type === "rail"
        ? 25 * 2 ** (count - 1) * (modifier === "rail" ? 2 : 1)
        : dice * (modifier === "utility" ? 10 : count === 2 ? 10 : 4);
  const override = fortuneRules[g.fortune?.cardId]?.rent;
  if (!affected(gameBoard(g), b, override)) return base;
  if (override.value < base && fortuneCovered(g, s.owner, "lasting"))
    return base;
  if (override.value > base && payerId && fortuneCovered(g, payerId, "lasting"))
    return base;
  return override.value;
}
function jail(g, p) {
  if (g.rules === "elite") {
    g.movement ??= { id: g.rollCount, paths: {} };
    const path = (g.movement.paths[p.id] ??= [p.position]);
    if (path.at(-1) !== 10) path.push(10);
  }
  if (g.rules === "elite" && p.position !== 10) roundTax(g, p);
  p.position = 10;
  p.jail = true;
  p.jailTurns = 0;
  g.extra = false;
  g.doubles = 0;
  log(g, `${p.name} отправляется в тюрьму.`);
}
function move(g, p, to, salary = true, direction = 1) {
  if (g.rules === "elite") {
    g.movement ??= { id: g.rollCount, paths: {} };
    const path = (g.movement.paths[p.id] ??= [p.position]);
    let position = p.position;
    while (position !== to) {
      position = (position + direction + 40) % 40;
      path.push(position);
      if (salary && direction === 1 && position === 10) roundTax(g, p);
    }
  }
  if (salary && to < p.position) {
    const income =
      200 + (g.rules === "elite" ? (p.shares * sharePrice(g)) / 5 : 0);
    p.money += income;
    if (g.rules === "elite") {
      p.policies = p.policies.filter((policy) => {
        if (["green", "blue"].includes(policy)) {
          g.insurance[policy]++;
          return false;
        }
        return true;
      });
      p.shareWindow = true;
      if (fortuneTrigger(g, "startHouse")) p.freeHouses++;
    }
    log(g, `${p.name}: +${income} за Старт.`);
  }
  p.position = to;
}
function pay(g, from, to, amount, reason) {
  if (amount > 0)
    g.queue.push({ from, to, amount, ...(reason ? { reason } : {}) });
}
function settle(g) {
  while (g.queue.length) {
    const d = g.queue[0],
      p = player(g, d.from);
    if (p.bankrupt) {
      g.queue.shift();
      continue;
    }
    if (d.kind === "mortgage") {
      g.pending = { type: "mortgageTransfer", player: d.from, index: d.index };
      return;
    }
    if (g.rules === "elite" && !d.insuranceChecked) {
      const policies =
        d.reason === "fortune"
          ? p.policies.filter(
              (policy) =>
                ["blue", "orange", "red"].includes(policy) &&
                !(policy === "blue" && g.fortune.coverage[p.id]),
            )
          : d.reason === "rent" || d.reason === "tax"
            ? p.policies.filter((policy) => policy === "red")
            : [];
      if (p.freeRed && ["fortune", "rent", "tax"].includes(d.reason))
        policies.push("red");
      if (policies.length) {
        g.pending = {
          type: "insurance",
          player: p.id,
          policies,
          amount: d.amount,
          reason: d.reason,
        };
        return;
      }
    }
    if (p.money < d.amount) {
      g.pending = { type: "debt", ...d };
      return;
    }
    p.money -= d.amount;
    if (d.to === "casino") g.casino.pot += d.amount;
    else if (d.to && !player(g, d.to).bankrupt)
      player(g, d.to).money += d.amount;
    log(
      g,
      `${p.name} платит ${d.amount}${d.to === "casino" ? " в кассу казино" : d.to ? " → " + player(g, d.to).name : " в банк"}.`,
    );
    g.queue.shift();
  }
  if (g.pending?.type === "debt") g.pending = null;
  if (g.afterDebt) {
    const next = g.afterDebt;
    g.afterDebt = null;
    if (next.type === "land") {
      land(g, player(g, next.id), next.steps, next.modifier);
      return;
    }
    if (next.type === "jailMove") {
      const p = player(g, next.id);
      p.jail = false;
      p.jailTurns = 0;
      move(g, p, (p.position + next.steps) % 40);
      land(g, p, next.steps);
      return;
    }
  }
  if (!g.pending && g.auctionQueue.length) {
    auction(g, g.auctionQueue.shift());
    return;
  }
  if (!g.pending) {
    g.phase = g.resumePhase ?? (g.extra ? "roll" : "end");
    delete g.resumePhase;
    if (active(g).bankrupt) nextTurn(g);
  }
  const survivors = g.players.filter((p) => !p.bankrupt);
  if (survivors.length === 1 && !g.pending) {
    g.winner = survivors[0].id;
    g.phase = "finished";
    log(g, `${survivors[0].name} побеждает!`);
  }
}
function event(g, p, card) {
  if (g.rules !== "elite") return;
  const item = { ...card, id: ++g.eventSequence, player: p.id };
  if (g.event) (g.eventQueue ??= []).push(item);
  else g.event = item;
}
function land(g, p, steps, modifier) {
  if (g.rules === "elite" && g.queue.length) {
    g.afterDebt = { type: "land", id: p.id, steps, modifier };
    settle(g);
    return;
  }
  const b = gameBoard(g)[p.position],
    s = g.properties[p.position];
  log(g, `${p.name}: ${b.name}.`);
  if (b.type === "fortune") {
    drawFortune(g, p);
    return;
  }
  if (b.type === "exchange") {
    if (fortuneTrigger(g, "exchangeShares")) {
      p.shares += g.market.available;
      g.market.available = 0;
    }
    g.pending = {
      type: "exchange",
      player: p.id,
      stage: "before",
      traded: false,
      adjust: fortuneTrigger(g, "exchangeAdjust"),
    };
    return;
  }
  if (b.type === "auction") {
    g.pending = { type: "randomAuction", player: p.id };
    return;
  }
  if (b.type === "exemption") p.taxExempt = true;
  if (g.rules === "elite" && b.type === "jail") {
    jail(g, p);
    settle(g);
    return;
  }
  if (b.type === "casino") {
    g.pending = {
      type: "casino",
      player: p.id,
      six: fortuneTrigger(g, "casinoSix"),
    };
    return;
  }
  if (s) {
    if (!s.owner) {
      g.pending = { type: "purchase", index: p.position, player: p.id };
      return;
    }
    if (s.owner !== p.id)
      pay(
        g,
        p.id,
        s.owner,
        rent(g, p.position, steps, modifier, p.id),
        g.rules === "elite" ? "rent" : undefined,
      );
  } else if (b.type === "tax") pay(g, p.id, null, b.amount);
  else if (b.type === "gotojail") jail(g, p);
  else if (b.type === "chance" || b.type === "chest") {
    if (fortuneTrigger(g, "chanceChoice")) {
      const choices = g.decks.chance.splice(0, 3);
      g.pending = { type: "chanceChoice", player: p.id, choices };
      return;
    }
    if (fortuneTrigger(g, "chanceThree"))
      g.chanceQueue = { player: p.id, remaining: 2 };
    draw(g, p, b.type);
    return;
  }
  settle(g);
}
function draw(g, p, deck, selectedIndex) {
  const index = selectedIndex ?? g.decks[deck].shift(),
    c = { ...(deck === "chance" ? chance : chest)[index] };
  if (g.rules === "elite") {
    if (c.move !== undefined)
      c.move =
        eliteBoard.find((b) => b.name === board[c.move].name)?.index ?? c.move;
    c.text = c.text
      .replaceAll("ВПЕРЁД", "Старт")
      .replaceAll("тюрьмы", "налоговой инспекции")
      .replaceAll("тюрьму", "налоговую инспекцию");
  }
  if (!c.free) g.decks[deck].push(index);
  g.lastCard = { deck, text: c.text };
  event(g, p, {
    deck,
    title: deck === "chance" ? "Шанс города" : "Фортуна",
    text: c.text,
  });
  log(g, `${deck === "chance" ? "Шанс" : "Казна"}: ${c.text}`);
  if (c.free) p.cards.push({ deck, index });
  if (c.jail) jail(g, p);
  if (c.money > 0) p.money += c.money;
  if (c.money < 0) pay(g, p.id, null, -c.money);
  if (c.repair) {
    const total = owned(g, p.id).reduce(
      (n, b) =>
        n +
        (g.properties[b.index].level === 5
          ? c.repair[1]
          : g.properties[b.index].level * c.repair[0]),
      0,
    );
    pay(g, p.id, null, total);
  }
  if (c.each)
    for (const other of g.players.filter((x) => x.id !== p.id && !x.bankrupt))
      pay(
        g,
        c.each > 0 ? other.id : p.id,
        c.each > 0 ? p.id : other.id,
        Math.abs(c.each),
      );
  if (c.move !== undefined) {
    move(g, p, c.move);
    land(g, p, 0);
    return;
  }
  if (c.back) {
    move(g, p, (p.position + 40 - c.back) % 40, false, -1);
    land(g, p, 0);
    return;
  }
  if (c.nearest) {
    let to = (p.position + 1) % 40;
    while (gameBoard(g)[to].type !== c.nearest) to = (to + 1) % 40;
    move(g, p, to);
    const dice =
      c.nearest === "utility" ? randomInt(1, 7) + randomInt(1, 7) : 0;
    land(g, p, dice, c.nearest);
    return;
  }
  settle(g);
}
function auction(g, index) {
  g.trade = null;
  g.pending = { type: "auction", index, bid: 0, leader: null, passed: [] };
  log(g, `Аукцион: ${gameBoard(g)[index].name}.`);
}
function finishAuction(g) {
  const a = g.pending,
    remaining = g.players.filter(
      (p) =>
        !p.bankrupt &&
        !a.passed.includes(p.id) &&
        (a.type !== "buildingAuction" || a.claims[p.id] !== undefined),
    );
  if (
    (a.leader && remaining.length === 1 && remaining[0].id === a.leader) ||
    remaining.length === 0
  ) {
    if (a.leader) {
      const p = player(g, a.leader);
      if (a.type === "buildingAuction")
        placeBuilding(g, p, a.claims[p.id], a.bid);
      else {
        p.money -= a.bid;
        if (g.rules === "elite" && g.properties[a.index].owner)
          player(g, g.properties[a.index].owner).money += a.bid;
        g.properties[a.index].owner = p.id;
        log(g, `${p.name} покупает ${gameBoard(g)[a.index].name} за ${a.bid}.`);
      }
    }
    g.pending = null;
    settle(g);
  }
}
function canBuild(g, p, i) {
  const b = gameBoard(g)[i],
    s = g.properties[i];
  return (
    b?.type === "street" &&
    s.owner === p.id &&
    !p.bankrupt &&
    whole(g, p.id, i) &&
    group(g, i).every((j) => !g.properties[j].mortgaged) &&
    s.level < 5 &&
    s.level === Math.min(...group(g, i).map((j) => g.properties[j].level))
  );
}
function placeBuilding(g, p, i, cost) {
  const s = g.properties[i];
  if (s.level === houseLimit(g)) {
    g.bank.hotels--;
    g.bank.houses += houseLimit(g);
    s.level = 5;
  } else {
    g.bank.houses--;
    s.level++;
    if (p.freeHouses && cost === gameBoard(g)[i].house) {
      p.freeHouses--;
      cost = 0;
    }
  }
  p.money -= cost;
  log(g, `${p.name} строит на ${gameBoard(g)[i].name} за ${cost}.`);
}
function finishBuildingRequest(g) {
  const a = g.pending;
  if (a.waiting.length) return;
  const ids = Object.keys(a.claims);
  if (ids.length === 1) {
    placeBuilding(
      g,
      player(g, ids[0]),
      a.claims[ids[0]],
      gameBoard(g)[a.claims[ids[0]]].house,
    );
    g.pending = null;
    settle(g);
  } else {
    g.pending = {
      type: "buildingAuction",
      building: a.building,
      claims: a.claims,
      bid: 0,
      leader: null,
      passed: [],
    };
    log(g, "Аукцион последнего здания. Начальная ставка 10.");
  }
}
function nextTurn(g) {
  if (g.rules === "elite") active(g).shareWindow = false;
  g.trade = null;
  g.extra = false;
  g.doubles = 0;
  do {
    g.turn = (g.turn + 1) % g.players.length;
  } while (active(g).bankrupt);
  g.phase = "roll";
  log(g, `Ход: ${active(g).name}.`);
}
function propertyAction(g, p, a) {
  const i = a.index,
    b = gameBoard(g)[i],
    s = g.properties[i];
  fail(s && s.owner === p.id, "Это не ваша собственность");
  const peers = b.type === "street" ? group(g, i) : [i];
  if (a.type === "mortgage") {
    fail(
      !s.mortgaged && peers.every((j) => g.properties[j].level === 0),
      "Сначала продайте все здания цветовой группы",
    );
    s.mortgaged = true;
    p.money += b.price / 2;
  }
  if (a.type === "unmortgage") {
    const cost = Math.ceil((b.price * (g.rules === "elite" ? 60 : 55)) / 100);
    fail(s.mortgaged && p.money >= cost, "Недостаточно денег или нет залога");
    s.mortgaged = false;
    p.money -= cost;
  }
  if (a.type === "build") {
    fail(!g.pending, "Сначала завершите текущее действие");
    fail(canBuild(g, p, i), "Нужна вся группа без залогов; стройте равномерно");
    fail(
      p.money >= b.house || (p.freeHouses && s.level < houseLimit(g)),
      "Недостаточно денег",
    );
    const building = s.level === houseLimit(g) ? "hotels" : "houses";
    fail(g.bank[building] > 0, "В банке нет нужных зданий");
    const waiting = g.players
      .filter(
        (q) =>
          q.id !== p.id &&
          q.money >= 10 &&
          gameBoard(g).some(
            (b) =>
              canBuild(g, q, b.index) &&
              (g.properties[b.index].level === houseLimit(g)
                ? "hotels"
                : "houses") === building,
          ),
      )
      .map((q) => q.id);
    if (g.bank[building] === 1 && waiting.length) {
      g.resumePhase = g.phase;
      g.trade = null;
      g.pending = {
        type: "buildingRequest",
        building,
        claims: { [p.id]: i },
        waiting,
      };
      return;
    }
    placeBuilding(g, p, i, b.house);
  }
  if (a.type === "sell") {
    fail(
      s.level > 0 &&
        s.level === Math.max(...peers.map((j) => g.properties[j].level)),
      "Продавайте здания равномерно",
    );
    if (s.level === 5) {
      fail(
        g.bank.houses >= houseLimit(g),
        `Для размена отеля нужны ${houseLimit(g)} дома в банке; используйте продажу всей застройки группы`,
      );
      g.bank.hotels++;
      g.bank.houses -= houseLimit(g);
    } else g.bank.houses++;
    s.level = s.level === 5 ? houseLimit(g) : s.level - 1;
    p.money += b.house / 2;
  }
  if (a.type === "sellGroup") {
    fail(
      b.type === "street" && whole(g, p.id, i),
      "Нужна ваша цветовая группа",
    );
    for (const j of peers) {
      const t = g.properties[j];
      p.money += buildingValue(g, gameBoard(g)[j], t) / 2;
      if (t.level === 5) g.bank.hotels++;
      else g.bank.houses += t.level;
      t.level = 0;
    }
  }
  log(
    g,
    `${p.name}: ${{ mortgage: "залог", unmortgage: "выкуп залога", build: "строительство", sell: "продажа здания", sellGroup: "продажа застройки группы" }[a.type]} — ${b.name}.`,
  );
  if (g.pending?.type === "debt") settle(g);
}
function bankrupt(g, p) {
  const d = g.pending;
  fail(
    d?.type === "debt" && d.from === p.id,
    "Банкротство возможно при непогашенном долге",
  );
  const available =
    p.money +
    (g.rules === "elite" ? p.shares * sharePrice(g) : 0) +
    owned(g, p.id).reduce(
      (n, b) =>
        n +
        buildingValue(g, b, g.properties[b.index]) / 2 +
        (g.properties[b.index].mortgaged ? 0 : b.price / 2),
      0,
    );
  fail(
    available < d.amount,
    "Вы ещё можете погасить долг: продайте здания или заложите собственность",
  );
  // Buildings are returned at half price before the estate is transferred.
  for (const b of owned(g, p.id)) {
    const s = g.properties[b.index];
    p.money += buildingValue(g, b, s) / 2;
    if (s.level === 5) g.bank.hotels++;
    else g.bank.houses += s.level;
    s.level = 0;
  }
  if (g.rules === "elite") {
    if (d.to === "casino") g.casino.pot += d.amount;
    else if (d.to) player(g, d.to).money += d.amount;
    for (const c of p.cards) g.decks[c.deck].push(c.index);
    g.market.available += p.shares;
    p.shares = 0;
    for (const policy of p.policies) g.insurance[policy]++;
    p.policies = [];
    if (p.freeRed) g.insurance.red++;
    p.freeRed = false;
    for (const b of owned(g, p.id))
      Object.assign(g.properties[b.index], {
        owner: null,
        level: 0,
        mortgaged: false,
      });
  } else if (d.to) {
    player(g, d.to).money += p.money;
    player(g, d.to).cards.push(...p.cards);
  } else for (const c of p.cards) g.decks[c.deck].push(c.index);
  for (const b of owned(g, p.id)) {
    const s = g.properties[b.index];
    s.owner = d.to;
    if (d.to && s.mortgaged)
      g.queue.push({ kind: "mortgage", from: d.to, index: b.index });
    if (!d.to) {
      s.mortgaged = false;
      g.auctionQueue.push(b.index);
    }
  }
  p.money = 0;
  p.cards = [];
  p.bankrupt = true;
  g.queue.shift();
  g.pending = null;
  if (active(g).id === p.id) {
    g.afterDebt = null;
    g.extra = false;
  }
  g.trade = null;
  log(g, `${p.name} объявляет банкротство.`);
  settle(g);
}
function trade(g, p, a) {
  if (a.type === "offer") {
    fail(
      !g.pending || g.pending.type === "debt",
      "Сначала завершите текущее действие",
    );
    fail(!g.trade, "Сначала отмените предыдущее предложение");
    const to = player(g, a.to);
    fail(to && !to.bankrupt && to.id !== p.id, "Выберите другого игрока");
    const offer = {
      from: p.id,
      to: to.id,
      give: a.give || [],
      take: a.take || [],
      giveMoney: a.giveMoney || 0,
      takeMoney: a.takeMoney || 0,
      giveCard: !!a.giveCard,
      takeCard: !!a.takeCard,
    };
    validateTrade(g, offer);
    g.trade = offer;
    return;
  }
  fail(g.trade, "Нет предложения");
  if (a.type === "cancelTrade") {
    fail([g.trade.from, g.trade.to].includes(p.id), "Это чужое предложение");
    g.trade = null;
    return;
  }
  const t = g.trade;
  fail(t.to === p.id, "Предложение адресовано другому игроку");
  fail(
    !g.pending || g.pending.type === "debt",
    "Сначала завершите текущее действие",
  );
  validateTrade(g, t);
  const from = player(g, t.from),
    to = player(g, t.to);
  from.money += t.takeMoney - t.giveMoney;
  to.money += t.giveMoney - t.takeMoney;
  for (const [ids, recipient] of [
    [t.give, to],
    [t.take, from],
  ])
    for (const i of ids) {
      g.properties[i].owner = recipient.id;
      if (g.properties[i].mortgaged)
        g.queue.push({ kind: "mortgage", from: recipient.id, index: i });
    }
  if (t.giveCard) to.cards.push(from.cards.shift());
  if (t.takeCard) from.cards.push(to.cards.shift());
  log(g, `${from.name} и ${to.name} заключили сделку.`);
  g.trade = null;
  if (g.pending?.type === "debt") settle(g);
  else if (g.queue.length) {
    g.resumePhase = g.phase;
    settle(g);
  }
}
function validateTrade(g, t) {
  fail(Array.isArray(t.give) && Array.isArray(t.take), "Некорректный обмен");
  for (const [id, ids, money, card] of [
    [t.from, t.give, t.giveMoney, t.giveCard],
    [t.to, t.take, t.takeMoney, t.takeCard],
  ]) {
    const p = player(g, id);
    fail(
      !p.bankrupt && ids.length <= 28 && new Set(ids).size === ids.length,
      "Некорректный обмен",
    );
    fail(
      Number.isSafeInteger(money) && money >= 0 && p.money >= money,
      "Недостаточно денег на обмен",
    );
    fail(!card || p.cards.length > 0, "Нет карты выхода из тюрьмы");
    for (const i of ids) {
      fail(
        Number.isInteger(i) && g.properties[i]?.owner === id,
        "Собственность уже не принадлежит участнику",
      );
      fail(
        g.rules !== "elite" || !g.properties[i].mortgaged,
        "Заложенный участок нельзя передать",
      );
      fail(
        gameBoard(g)[i].type !== "street" ||
          group(g, i).every((j) => g.properties[j].level === 0),
        "Нельзя обменивать улицы застроенной группы",
      );
    }
  }
}
function actInternal(
  g,
  id,
  a,
  roll = () => [randomInt(1, 7), randomInt(1, 7)],
) {
  const p = player(g, id);
  fail(p && !p.bankrupt && !g.winner, "Вы не участвуете в активной игре");
  fail(a && typeof a.type === "string", "Некорректное действие");
  if (a.type === "ackEvent") {
    fail(
      g.event?.player === id && g.event.id === a.eventId,
      "Сейчас не ваша карта",
    );
    g.event = g.eventQueue?.shift() ?? null;
    return g;
  }
  fail(!g.event, "Сначала прочитайте карту и нажмите «Продолжить»");
  if (
    g.rules === "elite" &&
    ["insuranceUse", "insuranceDecline"].includes(a.type)
  ) {
    const pending = g.pending;
    fail(
      pending?.type === "insurance" && pending.player === id,
      "Сейчас не ваш страховой случай",
    );
    const debt = g.queue[0];
    if (a.type === "insuranceUse") {
      fail(
        pending.policies.includes(a.policy),
        "Полис не покрывает этот случай",
      );
      if (debt.reason === "fortune") consumePolicy(g, p, a.policy, "once");
      else {
        const index = p.policies.indexOf("red");
        if (index >= 0) {
          p.policies.splice(index, 1);
          g.insurance.red++;
        } else {
          p.freeRed = false;
          g.insurance.red++;
          (g.fortune.supportSpent ??= []).push(id);
        }
      }
      g.queue.shift();
      log(g, `${p.name}: полис покрывает ${debt.amount} ф.`);
    } else debt.insuranceChecked = true;
    g.pending = null;
    settle(g);
    return g;
  }
  if (g.rules === "elite" && a.type === "randomAuction") {
    fail(
      g.pending?.type === "randomAuction" && g.pending.player === id,
      "Сейчас не ваш аукцион",
    );
    const first = roll(),
      second = roll();
    g.pending = null;
    if (first[0] <= 4) {
      const groupId = (first[0] - 1) * 2 + (first[1] % 2 === 0 ? 1 : 0);
      const cells = eliteBoard.filter(
        (b) => b.type === "street" && b.group === groupId,
      );
      const index = cells[Math.ceil(second[0] / 2) - 1].index,
        state = g.properties[index];
      const owner = player(g, state.owner);
      if (!state.mortgaged && !state.level) {
        if (
          owner?.policies.some((policy) => ["green", "blue"].includes(policy))
        )
          log(g, `${owner.name}: полис защищает от аукциона.`);
        else if (
          owner &&
          (owner.policies.some((policy) =>
            ["orange", "red"].includes(policy),
          ) ||
            owner.freeRed)
        ) {
          g.pending = { type: "auctionInsurance", player: owner.id, index };
          return g;
        } else {
          auction(g, index);
          return g;
        }
      }
    }
    log(g, "Случайный аукцион отменён.");
    settle(g);
    return g;
  }
  if (
    g.rules === "elite" &&
    ["auctionInsure", "auctionAccept"].includes(a.type)
  ) {
    const pending = g.pending;
    fail(
      pending?.type === "auctionInsurance" && pending.player === id,
      "Это не ваш страховой случай",
    );
    if (a.type === "auctionInsure") {
      fail(
        ["orange", "red"].includes(a.policy) &&
          (p.policies.includes(a.policy) || (a.policy === "red" && p.freeRed)),
        "Нет подходящего полиса",
      );
      const index = p.policies.indexOf(a.policy);
      if (index >= 0) {
        p.policies.splice(index, 1);
        g.insurance[a.policy]++;
      } else {
        p.freeRed = false;
        g.insurance.red++;
        (g.fortune.supportSpent ??= []).push(id);
      }
      g.pending = null;
      settle(g);
    } else auction(g, pending.index);
    return g;
  }
  if (g.rules === "elite" && a.type === "protectFortune") {
    fail(g.fortune && !g.pending, "Сначала завершите действие");
    consumePolicy(g, p, a.policy, "lasting");
    return g;
  }
  if (g.rules === "elite" && a.type === "buyPolicy") {
    fail(
      active(g).id === id && g.phase === "roll" && !g.pending,
      "Полис покупается перед своим броском",
    );
    const price = policyPrices[a.policy];
    fail(
      price &&
        !p.policies.includes(a.policy) &&
        g.insurance[a.policy] > 0 &&
        p.money >= price,
      "Полис недоступен или не хватает денег",
    );
    p.money -= price;
    p.policies.push(a.policy);
    g.insurance[a.policy]--;
    return g;
  }
  if (g.rules === "elite" && ["shareBuy", "shareSell"].includes(a.type)) {
    fail(
      active(g).id === id || (a.type === "shareSell" && g.pending?.from === id),
      "Сейчас ход другого игрока",
    );
    const exchange = g.pending?.type === "exchange" && g.pending.player === id;
    const debtSale =
      a.type === "shareSell" &&
      g.pending?.type === "debt" &&
      g.pending.from === id;
    fail(
      exchange ||
        debtSale ||
        (!g.pending &&
          (g.phase === "roll" || (a.type === "shareBuy" && p.shareWindow))),
      "Сейчас операции с акциями недоступны",
    );
    fail(
      Number.isSafeInteger(a.count) && a.count > 0,
      "Укажите целое положительное количество",
    );
    if (exchange) fail(!g.pending.traded, "В этой стадии уже была операция");
    const price = sharePrice(g);
    if (a.type === "shareBuy") {
      fail(
        exchange || p.position === 0 || p.shareWindow,
        "Покупка акций доступна на Старте или Бирже",
      );
      fail(
        price > 0 &&
          a.count <= g.market.available &&
          p.money >= a.count * price,
        "Недостаточно денег или акций",
      );
      p.money -= a.count * price;
      p.shares += a.count;
      g.market.available -= a.count;
    } else {
      fail(a.count <= p.shares, "Недостаточно акций");
      p.money += a.count * price;
      p.shares -= a.count;
      g.market.available += a.count;
    }
    if (exchange) g.pending.traded = true;
    if (debtSale) settle(g);
    return g;
  }
  if (
    g.rules === "elite" &&
    ["exchangeRoll", "exchangeFinish"].includes(a.type)
  ) {
    fail(
      g.pending?.type === "exchange" && g.pending.player === id,
      "Сейчас не ваша Биржа",
    );
    if (a.type === "exchangeRoll") {
      fail(g.pending.stage === "before", "Курс уже определён");
      const dice = roll();
      const change = g.pending.adjust
        ? a.points
        : (dice[0] % 2 === 0 ? 1 : -1) * dice[1];
      fail(
        !g.pending.adjust ||
          (Number.isInteger(change) && Math.abs(change) <= 10),
        "Изменение курса — от −10 до 10 пунктов",
      );
      g.market.price = Math.max(0, g.market.price + change * 10);
      g.pending.stage = "after";
      g.pending.traded = false;
      log(g, `Биржа: курс ${sharePrice(g)} ф.`);
    } else {
      g.pending = null;
      settle(g);
    }
    return g;
  }
  if (g.rules === "elite" && a.type === "chanceChoose") {
    fail(
      g.pending?.type === "chanceChoice" && g.pending.player === id,
      "Нет выбора карты Шанса",
    );
    fail(g.pending.choices.includes(a.index), "Выберите одну из трёх карт");
    const choices = g.pending.choices;
    g.decks.chance.push(...choices.filter((i) => i !== a.index));
    g.pending = null;
    draw(g, p, "chance", a.index);
    return g;
  }
  if (
    g.rules === "elite" &&
    ["fortuneSale", "fortuneAuction", "fortuneLoss"].includes(g.pending?.type)
  ) {
    const pending = g.pending;
    fail(pending.player === id, "Это решение другого игрока");
    if (a.type === "fortuneAccept" || a.type === "fortuneInsure") {
      if (a.type === "fortuneInsure") consumePolicy(g, p, a.policy, "once");
      if (!fortuneCovered(g, id, "once")) {
        if (pending.type === "fortuneSale") {
          fail(
            Number.isSafeInteger(a.count) &&
              a.count >= 0 &&
              a.count <= p.shares,
            "Некорректное количество акций",
          );
          p.shares -= a.count;
          g.market.available += a.count;
          p.money += a.count * 300;
        }
        if (pending.type === "fortuneLoss") {
          g.market.available += p.shares;
          p.shares = 0;
        }
        if (pending.type === "fortuneAuction") {
          fail(pending.choices.includes(a.index), "Выберите мост");
          if (p.policies.includes("green") || p.policies.includes("blue")) {
            g.pending = null;
            settle(g);
            return g;
          }
          auction(g, a.index);
          return g;
        }
      }
      g.pending = null;
      settle(g);
      return g;
    }
    throw Error("Сначала завершите решение Фортуны");
  }
  if (a.type === "casinoSpin" || a.type === "casinoSkip") {
    fail(
      g.pending?.type === "casino" && g.pending.player === id,
      "Казино доступно только при посещении",
    );
    if (a.type === "casinoSpin") {
      fail(p.money >= casinoStake, "Для ставки нужно 50 фантов");
      const before = p.money;
      const first = roll(),
        second = roll();
      let dice = [first[0], first[1], second[0]];
      if (g.pending.six) {
        const third = roll();
        const pairs = [
          [first[0], first[1]],
          [second[0], second[1]],
          [third[0], third[1]],
        ];
        const combinations = pairs[0].flatMap((a) =>
          pairs[1].flatMap((b) => pairs[2].map((c) => [a, b, c])),
        );
        dice = combinations.reduce((best, candidate) =>
          casinoResult(candidate, g.casino.pot + casinoStake).payout >
          casinoResult(best, g.casino.pot + casinoStake).payout
            ? candidate
            : best,
        );
      }
      const result = casinoResult(dice, g.casino.pot + casinoStake);
      p.money -= casinoStake;
      g.casino.pot += casinoStake;
      p.money += result.payout;
      if (result.kind === "jackpot") g.casino.pot = 0;
      g.casino.lastResult = {
        ...result,
        before,
        after: p.money,
        delta: p.money - before,
        player: id,
      };
      event(g, p, {
        deck: "casino",
        title: "Рай Лудомана",
        text: `Выплата: ${result.payout} ф.`,
        result: g.casino.lastResult,
      });
      log(g, `${p.name}: казино, ставка 50 ф., выплата ${result.payout} ф.`);
    }
    g.pending = null;
    settle(g);
    return g;
  }
  if (a.type === "mortgageChoice") {
    const pending = g.pending;
    fail(
      pending?.type === "mortgageTransfer" && pending.player === id,
      "Сейчас не ваш выбор залога",
    );
    const i = pending.index;
    g.queue.shift();
    g.pending = null;
    const amount = Math.ceil(
      (gameBoard(g)[i].price * (a.redeem ? 55 : 5)) / 100,
    );
    if (a.redeem) g.properties[i].mortgaged = false;
    g.queue.unshift({ from: id, to: null, amount });
    settle(g);
    return g;
  }
  if (a.type === "buildingClaim" || a.type === "buildingDecline") {
    const pending = g.pending;
    fail(
      pending?.type === "buildingRequest" && pending.waiting.includes(id),
      "Нет приглашения на покупку здания",
    );
    if (a.type === "buildingClaim") {
      fail(
        canBuild(g, p, a.index) &&
          (g.properties[a.index].level === houseLimit(g)
            ? "hotels"
            : "houses") === pending.building,
        "Выберите подходящую улицу",
      );
      pending.claims[id] = a.index;
    }
    pending.waiting = pending.waiting.filter((x) => x !== id);
    finishBuildingRequest(g);
    return g;
  }
  if (["offer", "acceptTrade", "cancelTrade"].includes(a.type)) {
    trade(g, p, a);
    return g;
  }
  if (
    ["mortgage", "unmortgage", "build", "sell", "sellGroup"].includes(a.type)
  ) {
    fail(
      !g.pending ||
        g.pending.type === "debt" ||
        (["purchase", "auction"].includes(g.pending.type) &&
          ["mortgage", "sell", "sellGroup"].includes(a.type)),
      "Сначала завершите текущее действие",
    );
    if (g.pending?.type === "debt")
      fail(
        g.pending.from === id &&
          ["mortgage", "sell", "sellGroup"].includes(a.type),
        "Сейчас должник должен погасить долг",
      );
    propertyAction(g, p, a);
    return g;
  }
  if (a.type === "bankrupt") {
    bankrupt(g, p);
    return g;
  }
  if (["bid", "pass"].includes(a.type)) {
    const pending = g.pending;
    fail(
      ["auction", "buildingAuction"].includes(pending?.type),
      "Аукцион не идёт",
    );
    fail(
      pending.type !== "buildingAuction" || pending.claims[id] !== undefined,
      "Вы не участвуете в этом аукционе",
    );
    fail(!pending.passed.includes(id), "Вы уже вышли из аукциона");
    if (a.type === "bid") {
      fail(
        Number.isSafeInteger(a.amount) &&
          a.amount >= Math.max(10, pending.bid + 1) &&
          a.amount <= p.money,
        "Ставка должна быть от 10, больше предыдущей и в пределах наличных",
      );
      pending.bid = a.amount;
      pending.leader = id;
    } else {
      fail(pending.leader !== id, "Лидер не может выйти из аукциона");
      pending.passed.push(id);
    }
    finishAuction(g);
    return g;
  }
  fail(active(g).id === id, "Сейчас ход другого игрока");
  if (a.type === "buy" || a.type === "auction") {
    const pending = g.pending;
    fail(pending?.type === "purchase", "Нет собственности для покупки");
    if (a.type === "auction") auction(g, pending.index);
    else {
      const b = gameBoard(g)[pending.index];
      fail(p.money >= b.price, "Недостаточно денег — отправьте на аукцион");
      p.money -= b.price;
      g.properties[b.index].owner = id;
      log(g, `${p.name} покупает ${b.name} за ${b.price}.`);
      g.pending = null;
      settle(g);
    }
    return g;
  }
  fail(!g.pending, "Сначала завершите обязательное действие");
  if (a.type === "end") {
    fail(g.phase === "end", "Сначала бросьте кубики");
    nextTurn(g);
  } else if (a.type === "jailPay" || a.type === "jailCard") {
    fail(p.jail && g.phase === "roll", "Вы не в тюрьме или уже бросили кубики");
    if (a.type === "jailPay") {
      fail(
        p.money >= 50,
        "Нужно 50; продайте здания или заложите собственность",
      );
      p.money -= 50;
    } else {
      fail(p.cards.length, "Нет карты");
      const c = p.cards.shift();
      g.decks[c.deck].push(c.index);
    }
    p.jail = false;
    p.jailTurns = 0;
  } else if (a.type === "roll") {
    fail(g.phase === "roll", "Кубики уже брошены");
    g.trade = null;
    if (g.rules === "elite") p.shareWindow = false;
    g.lastCard = null;
    g.dice = roll();
    g.rollCount = (g.rollCount ?? 0) + 1;
    if (g.rules === "elite") g.movement = { id: g.rollCount, paths: {} };
    const [x, y] = g.dice,
      steps = x + y;
    log(g, `${p.name} бросает ${x} + ${y}.`);
    g.extra = false;
    if (p.jail) {
      p.jailTurns++;
      if (x === y) {
        p.jail = false;
        p.jailTurns = 0;
        move(g, p, (p.position + steps) % 40);
        land(g, p, steps);
      } else if (p.jailTurns === 3) {
        g.afterDebt = { type: "jailMove", id, steps };
        pay(g, id, null, 50);
        settle(g);
      } else {
        g.phase = "end";
      }
    } else {
      g.extra = x === y;
      g.doubles = g.extra ? g.doubles + 1 : 0;
      if (g.doubles === 3) {
        jail(g, p);
        g.phase = "end";
        if (g.rules === "elite") settle(g);
      } else {
        move(g, p, (p.position + steps) % 40);
        land(g, p, steps);
      }
    }
  } else throw Error("Неизвестное действие");
  return g;
}

const policyPrices = { green: 100, blue: 200, orange: 300, red: 500 };
const orderedPlayers = (g) =>
  Array.from(
    { length: g.players.length },
    (_, i) => g.players[(g.turn + i) % g.players.length],
  ).filter((p) => !p.bankrupt);
const estateValue = (g, p) =>
  owned(g, p.id).reduce(
    (sum, b) =>
      sum +
      b.price +
      (g.properties[b.index].level === 5 ? 4 : g.properties[b.index].level) *
        (b.house || 0),
    0,
  );
function fortuneCovered(g, id, term) {
  const cover = g.fortune?.coverage?.[id];
  return (
    !!cover?.[term] &&
    (cover.policy !== "blue" || player(g, id).policies.includes("blue"))
  );
}
function fortuneTrigger(g, trigger) {
  if (
    !g.fortune ||
    g.fortune.onceDone ||
    fortuneRules[g.fortune.cardId]?.trigger !== trigger
  )
    return false;
  g.fortune.onceDone = true;
  return true;
}
export function propertyTax(g, index) {
  const b = gameBoard(g)[index],
    s = g.properties[index];
  if (!s?.owner) return 0;
  // Printed Elite tax table: monopoly 2x; 1/2/3 houses 4x/6x/9x; hotel 15x.
  const base =
    b.type === "rail"
      ? [0, 50, 100, 200, 500][
          owned(g, s.owner).filter((c) => c.type === "rail").length
        ]
      : (b.type === "street" ? [15, 3, 30, 5, 100, 10, 25, 20][b.group] : 10) *
        (s.level === 5
          ? 15
          : s.level
            ? [1, 4, 6, 9][s.level]
            : b.type === "street" && whole(g, s.owner, index)
              ? 2
              : 1);
  const rule = fortuneRules[g.fortune?.cardId]?.tax;
  return affected(gameBoard(g), b, rule) &&
    !fortuneCovered(g, s.owner, "lasting")
    ? (rule.value ?? base * rule.multiplier)
    : base;
}
function roundTax(g, p) {
  if (p.taxExempt) {
    p.taxExempt = false;
    log(g, `${p.name}: освобождение от кругового налога.`);
    return;
  }
  const amount =
    p.shares * 10 +
    owned(g, p.id).reduce((sum, b) => sum + propertyTax(g, b.index), 0);
  pay(g, p.id, null, amount, "tax");
  log(g, `${p.name}: круговой налог ${amount} ф.`);
  if (fortuneTrigger(g, "taxCollector")) {
    for (const q of orderedPlayers(g).filter((q) => q.id !== p.id))
      pay(
        g,
        q.id,
        p.id,
        q.shares * 10 +
          owned(g, q.id).reduce((sum, b) => sum + propertyTax(g, b.index), 0),
        "tax",
      );
  }
}
function updateSupport(g) {
  for (const p of g.players) {
    if (p.freeRed) g.insurance.red++;
    p.freeRed = false;
  }
  if (fortuneRules[g.fortune?.cardId]?.support) {
    const p = orderedPlayers(g).reduce((a, b) => (b.money < a.money ? b : a));
    if (!g.fortune.supportSpent?.includes(p.id) && g.insurance.red > 0) {
      p.freeRed = true;
      g.insurance.red--;
    }
  }
}
function drawFortune(g, p) {
  const index = g.decks.fortune.shift();
  if (index === undefined) {
    event(g, p, {
      deck: "fortune",
      title: "Колесо Фортуны",
      text: "Все подтверждённые карты разыграны. Последнее общее условие остаётся действовать.",
    });
    settle(g);
    return;
  }
  const c = fortuneCards[index];
  g.fortuneDiscard.push(index);
  g.fortuneDecisions = [];
  g.fortune = { ...c, cardId: c.id, onceDone: false, coverage: {} };
  event(g, p, { ...c, deck: "fortune" });
  updateSupport(g);
  const kind = fortuneRules[c.id].immediate;
  if (!kind) {
    settle(g);
    return;
  }
  g.fortune.onceDone = true;
  const ps = orderedPlayers(g),
    shareholders = ps.filter((p) => p.shares > 0);
  const charge = (p, amount, to = null) => {
    if (!fortuneCovered(g, p.id, "once")) pay(g, p.id, to, amount, "fortune");
  };
  const max = (score, candidates = ps) =>
    candidates.reduce((a, b) => (score(b) > score(a) ? b : a));
  const min = (score, candidates = ps) =>
    candidates.reduce((a, b) => (score(b) < score(a) ? b : a));
  if (kind === "shareholder100") shareholders.forEach((p) => charge(p, 100));
  if (kind === "cashLeader") {
    const q = max((p) => p.money);
    charge(q, Math.floor(q.money / 2), "casino");
  }
  if (kind === "shareTax")
    shareholders.forEach((p) => charge(p, p.shares * sharePrice(g)));
  if (kind === "shareLeader" && shareholders.length) {
    const q = max((p) => p.shares, shareholders);
    charge(q, q.shares * sharePrice(g), "casino");
  }
  if (kind === "propertyLeader") {
    const q = max((p) => Math.max(0, ...owned(g, p.id).map((b) => b.price)));
    const b = owned(g, q.id).sort((a, b) => b.price - a.price)[0];
    if (b)
      charge(
        q,
        b.price +
          (g.properties[b.index].level === 5
            ? 4
            : g.properties[b.index].level) *
            (b.house || 0),
        "casino",
      );
  }
  if (kind === "redistribute") {
    const from = max((p) => estateValue(g, p)),
      to = min((p) => estateValue(g, p));
    if (from.id !== to.id) charge(from, Math.floor(from.money / 2), to.id);
  }
  if (kind === "taxExemption") {
    const q = min((p) => (40 - p.position) % 40);
    g.movement ??= { id: g.rollCount, paths: {} };
    (g.movement.paths[q.id] ??= [q.position]).push(30);
    q.position = 30;
    q.taxExempt = true;
  }
  if (kind === "completeDistrict") {
    for (const q of ps)
      for (let groupId = 0; groupId < 8; groupId++) {
        const cells = gameBoard(g).filter(
          (b) => b.type === "street" && b.group === groupId,
        );
        if (
          cells.filter((b) => g.properties[b.index].owner === q.id).length === 2
        ) {
          const third = cells.find((b) => !g.properties[b.index].owner);
          if (third) {
            g.properties[third.index].owner = q.id;
            log(g, `${q.name}: третий участок ${third.name} бесплатно.`);
          }
        }
      }
  }
  if (kind === "loseShares")
    for (const q of shareholders) {
      const qualifies = Array.from(
        { length: 8 },
        (_, groupId) =>
          owned(g, q.id).filter(
            (b) => b.type === "street" && b.group === groupId,
          ).length,
      ).some((n) => n >= 2);
      if (qualifies) g.fortuneDecisions ??= [];
      if (qualifies)
        g.fortuneDecisions.push({
          type: "fortuneLoss",
          player: q.id,
          shares: q.shares,
        });
    }
  if (kind === "bridgeAuction") {
    const q = ps.find(
      (q) => owned(g, q.id).filter((b) => b.type === "rail").length === 4,
    );
    if (q) {
      const choices = owned(g, q.id)
        .filter((b) => b.type === "rail" && !g.properties[b.index].mortgaged)
        .map((b) => b.index);
      if (choices.length) {
        g.fortuneDecisions ??= [];
        g.fortuneDecisions.push({
          type: "fortuneAuction",
          player: q.id,
          choices,
        });
      }
    }
  }
  if (kind === "stockSale" && shareholders.length > 1) {
    const q = min((p) => p.shares, shareholders);
    g.fortuneDecisions ??= [];
    g.fortuneDecisions.push({ type: "fortuneSale", player: q.id, price: 300 });
  }
  settle(g);
}
function consumePolicy(g, p, policy, term) {
  fail(
    ["blue", "orange", "red"].includes(policy),
    "Этот полис не покрывает Фортуну",
  );
  fail(
    p.policies.includes(policy) || (policy === "red" && p.freeRed),
    "Нет такого полиса",
  );
  if (policy === "blue")
    fail(
      !g.fortune.coverage[p.id]?.once && !g.fortune.coverage[p.id]?.lasting,
      "Синий полис уже защищает один пункт этой Фортуны",
    );
  if (policy !== "blue") {
    const index = p.policies.indexOf(policy);
    if (index >= 0) {
      p.policies.splice(index, 1);
      g.insurance[policy]++;
    } else {
      p.freeRed = false;
      g.insurance.red++;
      (g.fortune.supportSpent ??= []).push(p.id);
    }
  }
  g.fortune.coverage[p.id] = {
    policy,
    once: policy !== "blue" || term === "once",
    lasting: policy !== "blue" || term === "lasting",
  };
}
export function act(g, id, a, roll) {
  const result = actInternal(g, id, a, roll);
  if (g.rules === "elite") {
    updateSupport(g);
    if (!g.pending && !g.event && !g.winner) {
      if (g.fortuneDecisions?.length) g.pending = g.fortuneDecisions.shift();
      else if (g.chanceQueue?.remaining) {
        const q = g.chanceQueue;
        q.remaining--;
        draw(g, player(g, q.player), "chance");
      }
    }
  }
  return result;
}
