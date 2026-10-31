export function capturePieces(root) {
  return new Map(
    [...root.querySelectorAll(".pieces [data-player]")].map((piece) => [
      piece.dataset.player,
      piece.getBoundingClientRect(),
    ]),
  );
}

export function animatePieces(
  root,
  positions,
  reducedMotion,
  movement,
  elapsed = Infinity,
) {
  let remaining = 0;
  for (const piece of root.querySelectorAll(".pieces [data-player]")) {
    const path = movement?.paths[piece.dataset.player];
    if (path?.length > 1 && Number.isFinite(elapsed)) {
      const points = path.map((index) => {
        const rect = root
          .querySelector(`.cell[data-cell="${index}"]`)
          .getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });
      const { frames, duration } = hopFrames(points, reducedMotion);
      if (elapsed < duration) {
        const cell = piece.closest(".cell");
        cell.classList.add("piece-moving");
        const animation = piece.animate(frames, {
          duration,
          fill: "backwards",
          easing: "linear",
        });
        animation.currentTime = Math.max(0, elapsed);
        animation.onfinish = animation.oncancel = () =>
          cell.classList.remove("piece-moving");
        remaining = Math.max(remaining, duration - elapsed);
      }
      continue;
    }
    if (reducedMotion) continue;
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
  return remaining;
}

export function hopFrames(points, reducedMotion) {
  const delay = reducedMotion ? 120 : 1400;
  const step = reducedMotion ? 80 : 360;
  const duration = delay + (points.length - 1) * step;
  const target = points.at(-1);
  const translate = (p) =>
    `translate(${p.x - target.x}px, ${p.y - target.y}px)`;
  const frames = [
    { transform: translate(points[0]), offset: 0 },
    { transform: translate(points[0]), offset: delay / duration },
  ];
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1],
      to = points[i];
    if (!reducedMotion)
      frames.push({
        transform:
          translate({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 18 }) +
          " scale(1.08)",
        offset: (delay + (i - 1) * step + 150) / duration,
        easing: "ease-in",
      });
    frames.push({
      transform: translate(to),
      offset: (delay + (i - 1) * step + (step * 5) / 6) / duration,
    });
    frames.push({
      transform: translate(to),
      offset: (delay + i * step) / duration,
    });
  }
  return { frames, duration };
}
