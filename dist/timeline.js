// Signed difference also works across the Arduino millis() 32-bit rollover.
export function difference(a, b) { return (a - b) | 0; }

// Render a scheduled round locally; scores always come from the board.
export function visualState(status, boardNow) {
  const view = { ...status };
  const plan = status.timeline;
  if (plan && ['prepare', 'watch'].includes(status.phase)) {
    const elapsed = difference(boardNow, plan.start);
    const step = plan.on + plan.gap;
    const index = Math.floor(elapsed / step);
    view.litColor = -1;
    if (elapsed < 0) view.phase = 'prepare';
    else if (index < plan.colors.length) {
      view.phase = 'watch';
      if (elapsed % step < plan.on) view.litColor = plan.colors[index];
    } else view.phase = 'input';
  } else if (['input', 'round'].includes(status.phase) &&
             Number.isFinite(status.feedbackUntil) &&
             difference(boardNow, status.feedbackUntil) >= 0) {
    view.litColor = -1;
  }
  return view;
}
