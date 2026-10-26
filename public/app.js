import { board } from "./board.js";
import { figures } from "./figures.js";
import { capturePieces, animatePieces } from "./pieces.js";
const $ = (s) => document.querySelector(s),
  app = $("#app");
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n) =>
  `${new Intl.NumberFormat("ru-RU").format(n)} <small>₩</small>`;
const palette = [
  "#e64b4b",
  "#3976d6",
  "#d49416",
  "#8a56be",
  "#299e7a",
  "#e575a8",
  "#697780",
  "#bd6f30",
];
const figureHTML = (p) => {
  const f = figures[p.figure ?? p.color];
  return `<span class="figure-image"><img src="${f.image}" alt="${f.name}" draggable="false"></span>`;
};
let ws,
  room = null,
  diceRollStarted = null,
  you = null,
  rooms = [],
  connected = false,
  replaced = false,
  selected = null,
  tab = "estate",
  session = null;
try {
  session = JSON.parse(sessionStorage.getItem("monopoly-session"));
} catch {}
function savedSessions() {
  try {
    return JSON.parse(localStorage.getItem("monopoly-saved") || "{}");
  } catch {
    return {};
  }
}
function rememberSession() {
  if (!session || !room) return;
  const saved = savedSessions();
  if (saved[room.code]?.token === session.token) delete saved[room.code];
  const key = `${room.code}:${you}`;
  saved[key] = {
    ...session,
    key,
    name: room.players.find((p) => p.id === you)?.name || "",
    roomName: room.name,
  };
  localStorage.setItem("monopoly-saved", JSON.stringify(saved));
}
function forgetSession() {
  if (!session) return;
  const saved = savedSessions();
  for (const [key, value] of Object.entries(saved)) {
    if (value.token === session.token) delete saved[key];
  }
  localStorage.setItem("monopoly-saved", JSON.stringify(saved));
}
function resumeHTML() {
  const saved = Object.values(savedSessions()).filter((s) =>
    rooms.some((r) => r.code === s.code),
  );
  return saved.length
    ? `<div class="room-list"><div class="list-heading">ВЕРНУТЬСЯ К СВОИМ ИГРАМ</div>${saved.map((s) => `<button class="room-item" data-resume="${escape(s.key || s.code)}"><span>${escape(s.roomName)}<small>Вы: ${escape(s.name)}</small></span><b>Продолжить ↗</b></button>`).join("")}</div>`
    : "";
}
const send = (value) => {
  if (ws?.readyState === 1) ws.send(JSON.stringify(value));
  else toast("Нет связи с сервером. Переподключаемся…");
};
const action = (type, extra = {}) =>
  send({ type: "action", action: { type, ...extra } });
let toastTimer;
function toast(s) {
  $("#toast").textContent = s;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 5000);
}
function connect() {
  let initialRoom = true;
  ws = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
  );
  ws.onopen = () => {
    connected = true;
    $("#connection").textContent = "● На связи";
    $("#connection").className = "status online";
    if (session) send({ type: "resume", ...session });
  };
  ws.onmessage = (event) => {
    const m = JSON.parse(event.data);
    if (m.type === "rooms") {
      rooms = m.rooms;
      if (!room) render();
    }
    if (m.type === "session") {
      session = { code: m.code, token: m.token };
      sessionStorage.setItem("monopoly-session", JSON.stringify(session));
    }
    if (m.type === "room") {
      const previous = room?.game?.rollCount ?? 0;
      const next = m.room.game?.rollCount ?? 0;
      if (!initialRoom && room?.code === m.room.code && next > previous)
        diceRollStarted = performance.now();
      else if (initialRoom || next < previous || room?.code !== m.room.code)
        diceRollStarted = null;
      initialRoom = false;
      room = m.room;
      you = m.you;
      rememberSession();
      render();
    }
    if (m.type === "left" || m.type === "sessionExpired") {
      forgetSession();
      session = null;
      sessionStorage.removeItem("monopoly-session");
      room = null;
      diceRollStarted = null;
      render();
    }
    if (m.type === "replaced") {
      replaced = true;
      toast("Ваше место открыто в другой вкладке.");
    }
    if (m.type === "error") toast(m.message);
  };
  ws.onclose = () => {
    connected = false;
    $("#connection").textContent = replaced
      ? "Открыто в другой вкладке"
      : "○ Связь потеряна";
    $("#connection").className = "status";
    if (!replaced) setTimeout(connect, 1500);
  };
}
function cellPosition(i) {
  if (i <= 10) return [11, 11 - i];
  if (i <= 20) return [21 - i, 1];
  if (i <= 30) return [1, i - 19];
  return [i - 29, 11];
}
const symbol = (b) =>
  ({
    go: "↖",
    chest: "▣",
    chance: "?",
    tax: "₩",
    rail: "🚂",
    utility: b.index === 12 ? "💡" : "💧",
    jail: "▥",
    parking: "🚘",
    gotojail: "↙",
  })[b.type] || "";
function piecesHTML(players) {
  return players.length
    ? `<span class="pieces">${players.map((p) => `<i data-player="${escape(p.id)}" title="${escape(p.name)}" style="background:${palette[p.color]}">${figureHTML(p)}</i>`).join("")}</span>`
    : "";
}
function boardHTML(g, preview = false) {
  const elapsed =
    diceRollStarted === null ? 850 : performance.now() - diceRollStarted;
  const rolling = elapsed < 850;
  return `<div class="board ${preview ? "preview-board" : ""}"><div class="board-center"><div class="edition">ЭКОНОМИЧЕСКАЯ ИГРА ДЛЯ ДРУЗЕЙ</div><div class="board-logo">МИЛЛИОНЕР<i>Elite</i></div><div class="center-tagline">ПОКУПАЙТЕ. ТОРГУЙТЕСЬ. ПОБЕЖДАЙТЕ.</div><div class="card-decks"><div class="deck chest">▣<span>ОБЩЕСТВЕННАЯ<br>КАЗНА</span></div><div class="deck chance">?<span>ШАНС</span></div></div>${g ? `<div class="dice${rolling ? " rolling" : ""}" style="--roll-delay:-${elapsed}ms" role="img" aria-live="polite" aria-label="Кубики: ${g.dice.join(" и ")}"><span>${"⚀⚁⚂⚃⚄⚅"[g.dice[0] - 1]}</span><span>${"⚀⚁⚂⚃⚄⚅"[g.dice[1] - 1]}</span></div><div class="bank-stock">БАНК <b>⌂ ${g.bank.houses}</b> домов <b>▥ ${g.bank.hotels}</b> отелей</div>${g.lastCard ? `<div class="drawn-card">${escape(g.lastCard.text)}</div>` : ""}` : `<div class="board-invite">Город возможностей.<br><em>Ваш следующий ход.</em></div>`}</div>${board
    .map((b) => {
      const [row, col] = cellPosition(b.index),
        s = g?.properties[b.index],
        owner = g?.players.find((p) => p.id === s?.owner),
        players =
          g?.players.filter((p) => !p.bankrupt && p.position === b.index) || [];
      return `<button class="cell ${b.index % 10 === 0 ? "corner" : ""} ${b.type} ${selected === b.index ? "selected" : ""} ${s?.mortgaged ? "mortgaged" : ""}" style="grid-row:${row};grid-column:${col};${owner ? "--owner:" + palette[owner.color] + ";" : ""}" data-cell="${b.index}" aria-label="${escape(b.name)}${b.price ? ", цена " + b.price : ""}">${b.type === "jail" ? [true, false].map((jailed) => `<span class="jail-zone ${jailed ? "inmates" : "visitors"}"><span class="jail-label">${jailed ? "Тюрьма" : "Посещение"}</span>${piecesHTML(players.filter((p) => Boolean(p.jail) === jailed))}</span>`).join("") : b.type === "street" ? `<div class="color-band" style="background:${b.color}">${s?.level ? (s.level === 5 ? "▥" : "⌂".repeat(s.level)) : ""}</div>` : `<span class="cell-symbol">${symbol(b)}</span>`}${b.type !== "jail" ? `<span class="cell-name">${escape(b.name)}</span>` : ""}${b.price ? `<span class="cell-price">${b.price} ₩</span>` : ""}${owner ? '<i class="owner-dot"></i>' : ""}${b.type !== "jail" ? piecesHTML(players) : ""}</button>`;
    })
    .join("")}</div>`;
}
function render() {
  const positions = capturePieces(app);
  const focus = document.activeElement?.id;
  const value = focus && document.activeElement.value;
  const start = document.activeElement?.selectionStart;
  app.innerHTML = room ? (room.game ? gameHTML() : lobbyHTML()) : homeHTML();
  bind();
  animatePieces(
    app,
    positions,
    matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  if (focus && document.getElementById(focus)) {
    const el = document.getElementById(focus);
    if (value !== undefined) el.value = value;
    el.focus();
    if (
      typeof start === "number" &&
      el.setSelectionRange &&
      el.type !== "number"
    )
      el.setSelectionRange(start, start);
  }
}
function homeHTML() {
  return `<section class="home"><div class="hero-copy"><div class="eyebrow"><span></span> КАПИТАЛ НАЧИНАЕТСЯ С ИДЕИ</div><h1>Большой город.<br>Большие планы.<br><em>Ваш ход.</em></h1><p class="intro">Соберите друзей за одним столом.<br>Инвестируйте в недвижимость, заключайте сделки<br>и постройте свою финансовую империю.</p><div class="entry-card"><label for="nickname">Как вас зовут за игровым столом?</label><input id="nickname" placeholder="Ваш никнейм" autocomplete="nickname" value="${escape(localStorage.getItem("monopoly-name") || "")}"><div class="entry-actions"><button id="create" class="primary">Создать комнату <span>↗</span></button><button id="joinToggle" class="secondary">Войти по коду</button></div><div class="join-line"><input id="roomCode" placeholder="Код комнаты" value="${escape(new URLSearchParams(location.search).get("room") || "")}"><button id="join" class="dark">Войти →</button></div><div class="entry-note">Без регистрации · 2–8 игроков · Игра по сети</div></div>${resumeHTML()}<div class="room-list"><div class="list-heading">ОТКРЫТЫЕ КОМНАТЫ <span>${rooms.filter((r) => !r.started).length}</span></div>${
    rooms
      .filter((r) => !r.started)
      .map(
        (r) =>
          `<button class="room-item" data-join="${r.code}"><span>${escape(r.name)}<small>${r.code}</small></span><b>${r.count}/8 <i>↗</i></b></button>`,
      )
      .join("") ||
    '<p class="empty">Пока тихо. Создайте первый стол для друзей.</p>'
  }</div></div><div class="hero-board">${boardHTML(null, true)}<div class="table-note"><span>01 — 40</span> Недвижимость. Сделки. Большие возможности.</div></div></section>`;
}
function roomHeader() {
  return `<div class="room-heading"><div><div class="eyebrow">ВАШ ИГРОВОЙ СТОЛ</div><h1>${escape(room.name)}</h1></div><div class="room-tools"><button id="copy" class="secondary">Пригласить друзей ↗</button><span class="code">${room.code}</span>${!room.game || room.game.winner ? '<button id="leave" class="quiet">Выйти</button>' : ""}</div></div>`;
}
function figurePickerHTML() {
  const me = room.players.find((p) => p.id === you);
  return `<fieldset class="figure-picker"><legend>Ваша мем-фигурка</legend><div class="figure-options">${figures.map((f, i) => `<button type="button" data-figure="${i}" aria-pressed="${(me.figure ?? me.color) === i}" title="${f.name}">${figureHTML({ figure: i })}<span class="figure-name">${f.name}</span></button>`).join("")}</div></fieldset>`;
}
function lobbyHTML() {
  return `${roomHeader()}<section class="lobby"><div class="lobby-main"><div class="eyebrow">СОБИРАЕМ КОМПАНИЮ</div><h2>Большая игра начинается<br>с хороших друзей.</h2><p class="muted">Отправьте ссылку друзьям. Когда все будут на месте, начинайте.</p><div class="seats">${room.players.map((p) => `<div class="seat"><div class="avatar" style="--p:${palette[p.color]}">${figureHTML(p)}</div><strong>${escape(p.name)}${p.id === you ? " <small>это вы</small>" : ""}</strong><span>${p.id === room.host ? "Создатель комнаты" : p.online ? "Готов к игре" : "Не в сети"}</span></div>`).join("")}${Array.from({ length: Math.max(0, 4 - room.players.length) }, () => '<div class="seat vacant"><div class="avatar">+</div><span>Место для друга</span></div>').join("")}</div>${figurePickerHTML()}${room.host === you ? `<button id="start" class="primary" ${room.players.length < 2 ? "disabled" : ""}>Начать игру · ${room.players.length} игроков →</button>` : '<p class="waiting">Ждём, пока создатель комнаты начнёт игру…</p>'}<div class="lobby-facts"><span><b>1 500 ₩</b>стартовый капитал</span><span><b>40 клеток</b>классическое поле</span><span><b>Без паролей</b>только ваши никнеймы</span></div></div><aside class="panel"><h3>За столом</h3>${chatHTML()}</aside></section>`;
}
function gameHTML() {
  const g = room.game,
    me = g.players.find((p) => p.id === you),
    current = g.players[g.turn];
  return `${roomHeader()}<section class="game-layout"><div class="board-wrap">${boardHTML(g)}</div><aside class="game-sidebar"><div class="turn-panel"><div class="eyebrow">${g.winner ? "ИГРА ЗАВЕРШЕНА" : current.id === you ? "ВАШ ХОД" : "СЕЙЧАС ХОДИТ"}</div><h2>${g.winner ? "🏆 " + escape(g.players.find((p) => p.id === g.winner).name) : figureHTML(current) + " " + escape(current.name)}</h2>${controls(g, me)}<p class="hint">${g.winner ? "Поздравляем победителя! Время для реванша?" : me.bankrupt ? "Вы выбыли. Можно следить за игрой и общаться." : g.pending ? "Завершите действие, чтобы продолжить игру." : g.phase === "roll" ? "Бросьте два кубика и сделайте свой ход." : "Управляйте собственностью или завершите ход."}</p></div><div class="players-panel">${g.players
    .map(
      (p) =>
        `<div class="player ${p.id === current.id && !g.winner ? "active" : ""} ${p.bankrupt ? "out" : ""}"><div class="player-token" style="background:${palette[p.color]}">${figureHTML(p)}</div><div class="player-name">${escape(p.name)}${p.id === you ? "<small>это вы</small>" : ""}<div class="property-stripes">${board
          .filter((b) => g.properties[b.index]?.owner === p.id)
          .map((b) => `<i style="background:${b.color || "#57676b"}"></i>`)
          .join(
            "",
          )}</div></div><div class="balance">${p.bankrupt ? "Банкрот" : money(p.money)}<small>${p.jail ? "В тюрьме" : room.players.find((x) => x.id === p.id)?.online ? "В сети" : "Нет связи"}</small></div></div>`,
    )
    .join(
      "",
    )}</div><div class="detail-panel"><div class="tabs"><button data-tab="estate" class="${tab === "estate" ? "active" : ""}">Собственность</button><button data-tab="log" class="${tab === "log" ? "active" : ""}">Ходы</button><button data-tab="chat" class="${tab === "chat" ? "active" : ""}">Чат</button></div>${
    tab === "estate"
      ? estateHTML(g, me)
      : tab === "log"
        ? `<div class="event-log">${[...g.log]
            .reverse()
            .map((t) => `<p>${escape(t)}</p>`)
            .join("")}</div>`
        : chatHTML()
  }</div></aside></section>`;
}
function controls(g, me) {
  const p = g.pending,
    current = g.players[g.turn];
  let html = "";
  if (g.winner)
    return room.host === you
      ? '<button id="rematch" class="primary">Сыграть ещё раз →</button>'
      : "";
  if (p?.type === "purchase") {
    html = `<div class="action-card"><strong>${escape(board[p.index].name)}</strong><p>Свободная собственность · ${money(board[p.index].price)}</p>${current.id === you ? `<button data-action="buy" class="primary" ${me.money < board[p.index].price ? "disabled" : ""}>Купить за ${board[p.index].price} ₩</button><button data-action="auction" class="secondary">Выставить на аукцион</button>` : `<p>Ожидаем решение ${escape(current.name)}</p>`}</div>`;
  } else if (p?.type === "auction" || p?.type === "buildingAuction") {
    const leader = g.players.find((x) => x.id === p.leader);
    html = `<div class="action-card"><div class="eyebrow">АУКЦИОН</div><strong>${p.type === "buildingAuction" ? (p.building === "houses" ? "Последний дом" : "Последний отель") : escape(board[p.index].name)}</strong><p>${leader ? escape(leader.name) + " · " : "Начальная ставка · "}${money(p.bid || 10)}</p>${!me.bankrupt && !p.passed.includes(you) && (p.type !== "buildingAuction" || p.claims[you] !== undefined) ? `<div class="bid-row"><input id="bidAmount" type="number" min="${Math.max(10, p.bid + 1)}" max="${me.money}" value="${p.bid + 10}" aria-label="Сумма ставки"><button id="bid" class="primary">Ставка</button></div><button data-action="pass" class="quiet" ${p.leader === you ? "disabled" : ""}>Пас — выйти из аукциона</button>` : "<p>Ожидаем завершения аукциона…</p>"}</div>`;
  } else if (p?.type === "mortgageTransfer") {
    const b = board[p.index];
    html = `<div class="action-card"><strong>Получен залог: ${escape(b.name)}</strong>${p.player === you ? `<p>Выкупите сейчас или заплатите только проценты. При более позднем выкупе проценты взимаются снова.</p><button id="redeemMortgage" class="primary">Выкупить · ${Math.ceil((b.price * 55) / 100)} ₩</button><button id="keepMortgage" class="secondary">Оставить залог · ${Math.ceil((b.price * 5) / 100)} ₩</button>` : `<p>Выбирает ${escape(g.players.find((x) => x.id === p.player).name)}.</p>`}</div>`;
  } else if (p?.type === "buildingRequest") {
    const eligible = board.filter((b) => {
      const s = g.properties[b.index];
      return (
        b.type === "street" &&
        s?.owner === you &&
        s.level < 5 &&
        (s.level === 4 ? "hotels" : "houses") === p.building &&
        board
          .filter((x) => x.group === b.group && x.type === "street")
          .every(
            (x) =>
              g.properties[x.index].owner === you &&
              !g.properties[x.index].mortgaged &&
              g.properties[x.index].level >= s.level,
          )
      );
    });
    html = `<div class="action-card"><strong>В банке остался ${p.building === "houses" ? "один дом" : "один отель"}</strong>${p.waiting.includes(you) ? `<p>Хотите купить? При нескольких желающих начнётся аукцион.</p><select id="buildingIndex" aria-label="Улица для здания">${eligible.map((b) => `<option value="${b.index}">${escape(b.name)}</option>`).join("")}</select><button id="claimBuilding" class="primary">Участвовать</button><button data-action="buildingDecline" class="secondary">Пропустить</button>` : "<p>Ждём решения остальных владельцев цветовых групп.</p>"}</div>`;
  } else if (p?.type === "debt") {
    html = `<div class="action-card debt"><strong>Нужно заплатить ${money(p.amount)}</strong><p>${escape(g.players.find((x) => x.id === p.from).name)} → ${p.to ? escape(g.players.find((x) => x.id === p.to).name) : "Банк"}</p>${p.from === you ? '<p>Продайте здания, заложите улицы или предложите обмен.</p><button id="bankrupt" class="danger">Объявить банкротство</button>' : "<p>Ждём погашения долга.</p>"}</div>`;
  } else if (current.id === you && !me.bankrupt) {
    html =
      me.jail && g.phase === "roll"
        ? `<p>Тюрьма · попытка ${me.jailTurns + 1} из 3</p><div class="jail-actions"><button data-action="jailPay" class="secondary" ${me.money < 50 ? "disabled" : ""}>Заплатить 50 ₩</button><button data-action="jailCard" class="secondary" ${!me.cards.length ? "disabled" : ""}>Карта выхода (${me.cards.length})</button></div>`
        : "";
    html += `<button data-action="${g.phase === "roll" ? "roll" : "end"}" class="primary large">${g.phase === "roll" ? "⚄ Бросить кубики" : "Завершить ход →"}</button>`;
  } else html = '<div class="waiting">Ожидаем действия игрока…</div>';
  if (!me.bankrupt && (!p || p.type === "debt"))
    html +=
      '<button id="trade" class="trade-button">⇄ Предложить обмен</button>';
  if (!me.bankrupt)
    html += `<button id="autoplay" class="secondary" aria-pressed="${!!me.autoplay}">Автопилот: ${me.autoplay ? "включён" : "выключен"}</button>`;
  if (g.trade) {
    const t = g.trade;
    html += `<div class="action-card"><strong>Предложение обмена</strong><p>${escape(g.players.find((p) => p.id === t.from).name)} → ${escape(g.players.find((p) => p.id === t.to).name)}</p><p>Отдаёт: ${tradeSummary(t.give, t.giveMoney, t.giveCard)}<br>Просит: ${tradeSummary(t.take, t.takeMoney, t.takeCard)}</p>${t.to === you ? '<button data-action="acceptTrade" class="primary">Принять обмен</button>' : ""}${[t.from, t.to].includes(you) ? '<button data-action="cancelTrade" class="secondary">Отклонить / отменить</button>' : ""}</div>`;
  }
  return html;
}
function tradeSummary(ids, cash, card) {
  return (
    [
      ...ids.map((i) => escape(board[i].name)),
      cash ? `${cash} ₩` : "",
      card ? "карта выхода" : "",
    ]
      .filter(Boolean)
      .join(", ") || "ничего"
  );
}
function estateHTML(g, me) {
  const owned = board.filter((b) => g.properties[b.index]?.owner === you),
    b = board[selected],
    s = g.properties[selected];
  return `${b ? `<div class="deed"><div class="deed-title" style="background:${b.color || "#e5e9df"}">${escape(b.name)}</div>${s ? `<div class="deed-body"><p>${s.owner ? escape(g.players.find((p) => p.id === s.owner).name) : "Банк"} ${s.mortgaged ? "· В залоге" : ""}</p><div class="rent-grid">${b.rents ? b.rents.map((r, i) => `<span>${i === 0 ? "Аренда" : i === 5 ? "С отелем" : i + " дом"}</span><b>${r} ₩</b>`).join("") : b.type === "rail" ? "<span>1 / 2 / 3 / 4 дороги</span><b>25 / 50 / 100 / 200</b>" : "<span>1 / 2 компании</span><b>4× / 10× кубики</b>"}<span>Стоимость</span><b>${b.price} ₩</b><span>Залог</span><b>${b.price / 2} ₩</b>${b.house ? `<span>Дом / отель</span><b>${b.house} ₩</b>` : ""}</div>${b.type === "street" ? '<p class="hint">Без зданий: двойная аренда при полной цветовой группе.</p>' : ""}${s.owner === you && !me.bankrupt && !g.winner ? `<div class="estate-actions"><button data-property="${s.mortgaged ? "unmortgage" : "mortgage"}" class="secondary">${s.mortgaged ? "Выкупить за " + Math.ceil((b.price * 55) / 100) : "Заложить за " + b.price / 2} ₩</button>${b.type === "street" ? `<button data-property="build" class="secondary">Построить · ${b.house} ₩</button><button data-property="sell" class="quiet">Продать одно здание</button><button data-property="sellGroup" class="quiet">Продать всю застройку группы</button>` : ""}</div>` : ""}</div>` : `<p class="deed-body">${b.type === "go" ? "Получите 200 ₩ при прохождении или остановке." : b.type === "parking" ? "Просто отдых. Никаких выплат и штрафов." : b.type === "jail" ? "В гостях — без ограничений. Заключённые могут получать аренду и торговать." : b.amount ? "Заплатите " + b.amount + " ₩ в банк." : "Следуйте указанию клетки или вытянутой карты."}</p>`}</div>` : '<p class="hint">Нажмите на клетку поля, чтобы посмотреть карточку и управлять собственностью.</p>'}<div class="estate-heading">ВАШ ПОРТФЕЛЬ <span>${owned.length}</span></div><div class="estate-list">${owned.map((b) => `<button data-cell="${b.index}"><i style="background:${b.color || "#5e6d76"}"></i><span>${escape(b.name)}</span><small>${g.properties[b.index].mortgaged ? "Залог" : g.properties[b.index].level === 5 ? "▥" : "⌂".repeat(g.properties[b.index].level)}</small></button>`).join("") || '<p class="empty">Первая улица ждёт своего владельца.</p>'}</div>`;
}
function chatHTML() {
  return `<div class="chat-messages">${room.chat.map((m) => `<p><b>${escape(m.name)}</b>${escape(m.text)}</p>`).join("") || '<p class="empty">Скажите друзьям «привет».</p>'}</div><form id="chatForm"><input id="chatText" placeholder="Сообщение друзьям…" maxlength="2000" aria-label="Сообщение"><button class="dark" aria-label="Отправить сообщение">↑</button></form>`;
}
function modal(content) {
  $("#modalBody").innerHTML = content;
  $("#modal").showModal();
}
function showTrade() {
  const g = room.game;
  modal(
    `<div class="eyebrow">ДОГОВОРИМСЯ?</div><h2>Предложить обмен</h2><label for="tradeTo">С кем торгуемся</label><select id="tradeTo">${g.players
      .filter((p) => p.id !== you && !p.bankrupt)
      .map((p) => `<option value="${p.id}">${escape(p.name)}</option>`)
      .join(
        "",
      )}</select><div id="tradeFields"></div><button id="sendTrade" class="primary">Отправить предложение →</button><p class="hint">Улицы застроенной группы обменивать нельзя. Получатель залога выбирает немедленный выкуп или оплату 10% стоимости залога с сохранением залога.</p>`,
  );
  const fields = () => {
    const to = $("#tradeTo").value;
    $("#tradeFields").innerHTML = `<div class="trade-columns">${[
      ["give", you, "Вы отдаёте"],
      ["take", to, "Вы получаете"],
    ]
      .map(
        ([key, id, title]) =>
          `<div><h3>${title}</h3><label for="${key}Money">Деньги</label><input id="${key}Money" type="number" min="0" value="0">${board
            .filter((b) => g.properties[b.index]?.owner === id)
            .map(
              (b) =>
                `<label class="check"><input type="checkbox" name="${key}" value="${b.index}">${escape(b.name)}${g.properties[b.index].mortgaged ? " (залог)" : ""}</label>`,
            )
            .join(
              "",
            )}<label class="check"><input id="${key}Card" type="checkbox" ${g.players.find((p) => p.id === id).cards.length ? "" : "disabled"}>Карта выхода из тюрьмы</label></div>`,
      )
      .join("")}</div>`;
  };
  fields();
  $("#tradeTo").onchange = fields;
  $("#sendTrade").onclick = () => {
    action("offer", {
      to: $("#tradeTo").value,
      give: [...document.querySelectorAll("[name=give]:checked")].map((x) =>
        Number(x.value),
      ),
      take: [...document.querySelectorAll("[name=take]:checked")].map((x) =>
        Number(x.value),
      ),
      giveMoney: Number($("#giveMoney").value),
      takeMoney: Number($("#takeMoney").value),
      giveCard: $("#giveCard").checked,
      takeCard: $("#takeCard").checked,
    });
    $("#modal").close();
  };
}
function bind() {
  const on = (id, event, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, fn);
  };
  document.querySelectorAll("[data-resume]").forEach(
    (el) =>
      (el.onclick = () => {
        const saved = savedSessions()[el.dataset.resume];
        session = { code: saved.code, token: saved.token };
        sessionStorage.setItem("monopoly-session", JSON.stringify(session));
        send({ type: "resume", ...session });
      }),
  );
  const name = () => {
    const n = $("#nickname").value;
    localStorage.setItem("monopoly-name", n);
    return n;
  };
  on("create", "click", () => send({ type: "create", name: name() }));
  on("join", "click", () =>
    send({ type: "join", name: name(), code: $("#roomCode").value.trim() }),
  );
  on("joinToggle", "click", () => $("#roomCode").focus());
  document
    .querySelectorAll("[data-join]")
    .forEach(
      (el) =>
        (el.onclick = () =>
          send({ type: "join", name: name(), code: el.dataset.join })),
    );
  document.querySelectorAll("[data-figure]").forEach((el) => {
    el.onclick = () =>
      send({ type: "figure", figure: Number(el.dataset.figure) });
  });
  on("start", "click", () => send({ type: "start" }));
  on("leave", "click", () => send({ type: "leave" }));
  on("rematch", "click", () => send({ type: "rematch" }));
  on("copy", "click", async () => {
    try {
      await navigator.clipboard.writeText(
        `${location.origin}/?room=${room.code}`,
      );
      toast("Ссылка скопирована. Отправьте её друзьям.");
    } catch {
      toast(`Код комнаты: ${room.code}`);
    }
  });
  document
    .querySelectorAll("[data-action]")
    .forEach((el) => (el.onclick = () => action(el.dataset.action)));
  document.querySelectorAll("[data-cell]").forEach(
    (el) =>
      (el.onclick = () => {
        if (room?.game) {
          selected = Number(el.dataset.cell);
          tab = "estate";
          render();
        } else if (!room) {
          toast(
            `${board[Number(el.dataset.cell)].name} — создайте комнату, чтобы сыграть.`,
          );
        }
      }),
  );
  document.querySelectorAll("[data-tab]").forEach(
    (el) =>
      (el.onclick = () => {
        tab = el.dataset.tab;
        render();
      }),
  );
  document
    .querySelectorAll("[data-property]")
    .forEach(
      (el) =>
        (el.onclick = () => action(el.dataset.property, { index: selected })),
    );
  on("bid", "click", () =>
    action("bid", { amount: Number($("#bidAmount").value) }),
  );
  on("trade", "click", showTrade);
  on("autoplay", "click", () =>
    send({ type: "autoplay", enabled: !room.game.players.find((p) => p.id === you).autoplay }),
  );
  on("redeemMortgage", "click", () =>
    action("mortgageChoice", { redeem: true }),
  );
  on("keepMortgage", "click", () =>
    action("mortgageChoice", { redeem: false }),
  );
  on("claimBuilding", "click", () =>
    action("buildingClaim", { index: Number($("#buildingIndex").value) }),
  );
  on("bankrupt", "click", () => {
    modal(
      '<h2>Объявить банкротство?</h2><p>Вы выйдете из партии. Собственность перейдёт кредитору или будет продана банком на аукционах.</p><button id="confirmBankrupt" class="danger">Да, объявить банкротство</button>',
    );
    $("#confirmBankrupt").onclick = () => {
      action("bankrupt");
      $("#modal").close();
    };
  });
  on("chatForm", "submit", (e) => {
    e.preventDefault();
    send({ type: "chat", text: $("#chatText").value });
    $("#chatText").value = "";
  });
}
$("#closeModal").onclick = () => $("#modal").close();
$("#modal").addEventListener("click", (e) => {
  if (e.target === $("#modal")) $("#modal").close();
});
$("#rulesButton").onclick = () =>
  modal(
    `<div class="eyebrow">КЛАССИЧЕСКАЯ ИГРА</div><h2>От первой улицы до империи.</h2><div class="rules"><p>2–8 игроков, по 1500 ₩ на старте. Побеждает последний игрок, который не стал банкротом. Поле и цены — классическая US-редакция; налоги 200 и 100.</p><h3>Покупка и аренда</h3><p>Ничья собственность покупается по цене поля. При отказе начинается аукцион для всех, включая отказавшегося. Начальная ставка 10, повышение — от 1. На чужой собственности аренда списывается автоматически.</p><h3>Дома и отели</h3><p>Соберите всю цветовую группу. Стройте и продавайте равномерно. После четырёх домов можно купить отель. В банке 32 дома и 12 отелей. Если несколько игроков претендуют на последнее здание, проводится аукцион. Здания продаются за половину цены.</p><h3>Залоги и обмен</h3><p>Перед залогом улицы продайте все здания её группы. Выкуп стоит сумму залога +10%. Аренда за заложенную собственность не взимается. Участники могут обменивать деньги, незастроенную собственность и карты выхода.</p><h3>Кубики и тюрьма</h3><p>Дубль даёт дополнительный бросок, три дубля подряд отправляют в тюрьму. Выйдите за 50, по карте или дублю. После третьей неудачной попытки заплатите 50 и пройдите выпавшее число. Дубль при выходе не даёт повторного броска.</p><h3>Банк и долг</h3><p>Проход ВПЕРЁД приносит 200. Бесплатная парковка не даёт денег. Если денег не хватает, продайте здания, заложите собственность или заключите сделку. При банкротстве имущество получает кредитор; имущество, возвращённое банку, выставляется на аукционы.</p><h3>Связь</h3><p>Место сохраняется в этом браузере. После закрытия вкладки нажмите «Продолжить» на главной. Не очищайте данные сайта во время партии. Если игрок отключился, игра ждёт его возвращения.</p></div>`,
  );
connect();
