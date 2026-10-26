import test from "node:test";
import assert from "node:assert/strict";
import { capturePieces, animatePieces } from "../public/pieces.js";

function piece(id, left, top) {
  const classes = new Set();
  return {
    dataset: { player: id },
    getBoundingClientRect: () => ({ left, top }),
    closest: () => ({
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
      },
    }),
    classes,
    animate(frames, options) {
      this.animation = { frames, options };
      return this.animation;
    },
  };
}
const root = (...pieces) => ({ querySelectorAll: () => pieces });

test("pieces move from their previous visible position and release the cell after finishing", () => {
  const positions = capturePieces(root(piece("a", 100, 200)));
  const target = piece("a", 40, 80);
  animatePieces(root(target), positions, false);
  assert.equal(target.animation.frames[0].transform, "translate(60px, 120px)");
  assert.equal(target.animation.frames[1].transform, "translate(0, 0)");
  assert.ok(target.classes.has("piece-moving"));
  target.animation.onfinish();
  assert.equal(target.classes.size, 0);
});

test("initial render, unchanged positions and reduced motion do not animate", () => {
  const target = piece("a", 40, 80);
  animatePieces(root(target), new Map(), false);
  assert.equal(target.animation, undefined);
  const positions = capturePieces(root(target));
  animatePieces(root(target), positions, false);
  assert.equal(target.animation, undefined);
  animatePieces(root(target), capturePieces(root(piece("a", 0, 0))), true);
  assert.equal(target.animation, undefined);
});
