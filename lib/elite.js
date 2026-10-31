// Elite reel positions, counted from the bottom of the printed board.
export const casinoReels = [
  ["cherry", "bell", "plum", "cherry", "bell", "seven"],
  ["bell", "seven", "cherry", "plum", "cherry", "plum"],
  ["plum", "cherry", "seven", "cherry", "bell", "bell"],
];
export const casinoStake = 50;
export function casinoResult(dice, pot) {
  if (
    dice.length !== 3 ||
    !dice.every((n) => Number.isInteger(n) && n >= 1 && n <= 6)
  )
    throw Error("Некорректные броски казино");
  const symbols = dice.map((n, i) => casinoReels[i][n - 1]);
  const counts = Object.fromEntries(
    symbols.map((s) => [s, symbols.filter((x) => x === s).length]),
  );
  const match = Object.entries(counts).find(([, n]) => n >= 2);
  if (!match) return { dice, symbols, kind: "lose", payout: 0 };
  const [symbol, count] = match;
  if (symbol === "seven" && count === 2)
    return { dice, symbols, kind: "jackpot", payout: pot };
  const multiplier = (
    count === 3
      ? { cherry: 10, bell: 20, plum: 30, seven: 50 }
      : { cherry: 2, bell: 3, plum: 5 }
  )[symbol];
  return {
    dice,
    symbols,
    kind: count === 3 ? "triple" : "pair",
    multiplier,
    payout: casinoStake * multiplier,
  };
}
