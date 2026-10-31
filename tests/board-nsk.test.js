import test from "node:test";
import assert from "node:assert/strict";
import { board } from "../lib/board.js";

test("поле Новосибирска содержит восемь районов по три участка и четыре моста", () => {
  assert.equal(board.length, 40);
  const districts = Object.groupBy(board.filter((cell) => cell.type === "street"), (cell) => cell.group);
  assert.deepEqual(Object.values(districts).map((cells) => cells.length), Array(8).fill(3));
  assert.deepEqual(board.filter((cell) => cell.type === "rail").map((cell) => cell.name), ["Бугринский мост", "Димитровский мост", "Октябрьский мост", "Ново-Николаевский мост"]);
});
