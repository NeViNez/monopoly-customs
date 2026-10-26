import { randomInt } from "node:crypto";
import { board, chance, chest } from "./board.js";
export { board };
const fail = (condition, message) => {
  if (!condition) throw Error(message);
};
const player = (g, id) => g.players.find((p) => p.id === id);
const active = (g) => g.players[g.turn];
const group = (i) =>
  board
    .filter((b) => b.type === "street" && b.group === board[i].group)
    .map((b) => b.index);
const owned = (g, id) =>
  board.filter((b) => g.properties[b.index]?.owner === id);
const whole = (g, id, i) => group(i).every((j) => g.properties[j].owner === id);
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
  const g = {
    players: players.map((p) => ({
      ...p,
      money: 1500,
      position: 0,
      jail: false,
      jailTurns: 0,
      cards: [],
      bankrupt: false,
    })),
    turn: 0,
    phase: "roll",
    doubles: 0,
    extra: false,
    dice: [1, 1],
    rollCount: 0,
    properties: Object.fromEntries(
      board
        .filter((b) => b.price)
        .map((b) => [b.index, { owner: null, level: 0, mortgaged: false }]),
    ),
    bank: { houses: 32, hotels: 12 },
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
    log: ["Игра началась. Каждый получает 1500."],
    winner: null,
  };
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
export function rent(g, i, dice, modifier) {
  const b = board[i],
    s = g.properties[i];
  if (!s?.owner || s.mortgaged) return 0;
  if (b.type === "street")
    return b.rents[s.level] * (s.level === 0 && whole(g, s.owner, i) ? 2 : 1);
  const count = owned(g, s.owner).filter((x) => x.type === b.type).length;
  return b.type === "rail"
    ? 25 * 2 ** (count - 1) * (modifier === "rail" ? 2 : 1)
    : dice * (modifier === "utility" ? 10 : count === 2 ? 10 : 4);
}
function jail(g, p) {
  p.position = 10;
  p.jail = true;
  p.jailTurns = 0;
  g.extra = false;
  g.doubles = 0;
  log(g, `${p.name} отправляется в тюрьму.`);
}
function move(g, p, to, salary = true) {
  if (salary && to < p.position) {
    p.money += 200;
    log(g, `${p.name}: +200 за ВПЕРЁД.`);
  }
  p.position = to;
}
function pay(g, from, to, amount) {
  if (amount > 0) g.queue.push({ from, to, amount });
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
    if (p.money < d.amount) {
      g.pending = { type: "debt", ...d };
      return;
    }
    p.money -= d.amount;
    if (d.to && !player(g, d.to).bankrupt) player(g, d.to).money += d.amount;
    log(
      g,
      `${p.name} платит ${d.amount}${d.to ? " → " + player(g, d.to).name : " в банк"}.`,
    );
    g.queue.shift();
  }
  if (g.pending?.type === "debt") g.pending = null;
  if (g.afterDebt) {
    const next = g.afterDebt;
    g.afterDebt = null;
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
function land(g, p, steps, modifier) {
  const b = board[p.position],
    s = g.properties[p.position];
  log(g, `${p.name}: ${b.name}.`);
  if (s) {
    if (!s.owner) {
      g.pending = { type: "purchase", index: p.position, player: p.id };
      return;
    }
    if (s.owner !== p.id)
      pay(g, p.id, s.owner, rent(g, p.position, steps, modifier));
  } else if (b.type === "tax") pay(g, p.id, null, b.amount);
  else if (b.type === "gotojail") jail(g, p);
  else if (b.type === "chance" || b.type === "chest") {
    draw(g, p, b.type);
    return;
  }
  settle(g);
}
function draw(g, p, deck) {
  const index = g.decks[deck].shift(),
    c = (deck === "chance" ? chance : chest)[index];
  if (!c.free) g.decks[deck].push(index);
  g.lastCard = { deck, text: c.text };
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
    move(g, p, (p.position + 40 - c.back) % 40, false);
    land(g, p, 0);
    return;
  }
  if (c.nearest) {
    let to = (p.position + 1) % 40;
    while (board[to].type !== c.nearest) to = (to + 1) % 40;
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
  log(g, `Аукцион: ${board[index].name}.`);
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
        g.properties[a.index].owner = p.id;
        log(g, `${p.name} покупает ${board[a.index].name} за ${a.bid}.`);
      }
    }
    g.pending = null;
    settle(g);
  }
}
function canBuild(g, p, i) {
  const b = board[i],
    s = g.properties[i];
  return (
    b?.type === "street" &&
    s.owner === p.id &&
    !p.bankrupt &&
    whole(g, p.id, i) &&
    group(i).every((j) => !g.properties[j].mortgaged) &&
    s.level < 5 &&
    s.level === Math.min(...group(i).map((j) => g.properties[j].level))
  );
}
function placeBuilding(g, p, i, cost) {
  const s = g.properties[i];
  if (s.level === 4) {
    g.bank.hotels--;
    g.bank.houses += 4;
  } else g.bank.houses--;
  s.level++;
  p.money -= cost;
  log(g, `${p.name} строит на ${board[i].name} за ${cost}.`);
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
      board[a.claims[ids[0]]].house,
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
    b = board[i],
    s = g.properties[i];
  fail(s && s.owner === p.id, "Это не ваша собственность");
  const peers = b.type === "street" ? group(i) : [i];
  if (a.type === "mortgage") {
    fail(
      !s.mortgaged && peers.every((j) => g.properties[j].level === 0),
      "Сначала продайте все здания цветовой группы",
    );
    s.mortgaged = true;
    p.money += b.price / 2;
  }
  if (a.type === "unmortgage") {
    const cost = Math.ceil((b.price * 55) / 100);
    fail(s.mortgaged && p.money >= cost, "Недостаточно денег или нет залога");
    s.mortgaged = false;
    p.money -= cost;
  }
  if (a.type === "build") {
    fail(!g.pending, "Сначала завершите текущее действие");
    fail(canBuild(g, p, i), "Нужна вся группа без залогов; стройте равномерно");
    fail(p.money >= b.house, "Недостаточно денег");
    const building = s.level === 4 ? "hotels" : "houses";
    fail(g.bank[building] > 0, "В банке нет нужных зданий");
    const waiting = g.players
      .filter(
        (q) =>
          q.id !== p.id &&
          q.money >= 10 &&
          board.some(
            (b) =>
              canBuild(g, q, b.index) &&
              (g.properties[b.index].level === 4 ? "hotels" : "houses") ===
                building,
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
        g.bank.houses >= 4,
        "Для размена отеля нужны 4 дома в банке; используйте продажу всей застройки группы",
      );
      g.bank.hotels++;
      g.bank.houses -= 4;
    } else g.bank.houses++;
    s.level--;
    p.money += b.house / 2;
  }
  if (a.type === "sellGroup") {
    fail(
      b.type === "street" && whole(g, p.id, i),
      "Нужна ваша цветовая группа",
    );
    for (const j of peers) {
      const t = g.properties[j];
      p.money += (t.level * board[j].house) / 2;
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
    owned(g, p.id).reduce(
      (n, b) =>
        n +
        (g.properties[b.index].level * (b.house || 0)) / 2 +
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
    p.money += (s.level * (b.house || 0)) / 2;
    if (s.level === 5) g.bank.hotels++;
    else g.bank.houses += s.level;
    s.level = 0;
  }
  if (d.to) {
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
        board[i].type !== "street" ||
          group(i).every((j) => g.properties[j].level === 0),
        "Нельзя обменивать улицы застроенной группы",
      );
    }
  }
}
export function act(g, id, a, roll = () => [randomInt(1, 7), randomInt(1, 7)]) {
  const p = player(g, id);
  fail(p && !p.bankrupt && !g.winner, "Вы не участвуете в активной игре");
  fail(a && typeof a.type === "string", "Некорректное действие");
  if (a.type === "mortgageChoice") {
    const pending = g.pending;
    fail(
      pending?.type === "mortgageTransfer" && pending.player === id,
      "Сейчас не ваш выбор залога",
    );
    const i = pending.index;
    g.queue.shift();
    g.pending = null;
    const amount = Math.ceil((board[i].price * (a.redeem ? 55 : 5)) / 100);
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
          (g.properties[a.index].level === 4 ? "hotels" : "houses") ===
            pending.building,
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
      const b = board[pending.index];
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
    g.lastCard = null;
    g.dice = roll();
    g.rollCount = (g.rollCount ?? 0) + 1;
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
      } else {
        move(g, p, (p.position + steps) % 40);
        land(g, p, steps);
      }
    }
  } else throw Error("Неизвестное действие");
  return g;
}
