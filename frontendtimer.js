let _timerHandle = null;

export async function maybeShowTimer(game) {
  try {
    const active = await game.isRoundActive();
    if (!active) return hideTimer();

    const start = Number(await game.roundStart());
    const duration = Number(await game.duration());
    const end = start + duration;

    const box = document.getElementById('timerContainer');
    const clock = document.getElementById('countdown');
    if (!box || !clock) return;

    box.style.display = 'block';

    if (_timerHandle) clearInterval(_timerHandle);
    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const left = Math.max(end - now, 0);
      clock.innerText =
        `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
      if (left === 0) {
        clearInterval(_timerHandle);
        // ask the backend/contract if the round just closed, then hide or re-arm UI
        box.style.display = 'none';
      }
    };
    tick();
    _timerHandle = setInterval(tick, 1000);
  } catch (e) {
    console.error('⏱ timer load failed', e);
  }
}

function hideTimer() {
  const box = document.getElementById('timerContainer');
  if (box) box.style.display = 'none';
  if (_timerHandle) clearInterval(_timerHandle);
  _timerHandle = null;
}

export const FF_GATE_JOIN_UNTIL_ACTIVE = false;
window.FF_GATE_JOIN_UNTIL_ACTIVE = FF_GATE_JOIN_UNTIL_ACTIVE;
