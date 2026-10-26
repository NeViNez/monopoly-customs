export function capturePieces(root) {
  return new Map(
    [...root.querySelectorAll(".pieces [data-player]")].map((piece) => [
      piece.dataset.player,
      piece.getBoundingClientRect(),
    ]),
  );
}

export function animatePieces(root, positions, reducedMotion) {
  if (reducedMotion) return;
  for (const piece of root.querySelectorAll(".pieces [data-player]")) {
    const from = positions.get(piece.dataset.player);
    if (!from) continue;
    const to = piece.getBoundingClientRect();
    const dx = from.left - to.left,
      dy = from.top - to.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    const cell = piece.closest(".cell");
    cell.classList.add("piece-moving");
    const animation = piece.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: "translate(0, 0)" },
      ],
      { duration: 550, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    animation.onfinish = animation.oncancel = () =>
      cell.classList.remove("piece-moving");
  }
}
