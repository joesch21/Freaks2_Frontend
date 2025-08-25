let timerHandle = null;

export async function startTimer(game) {
  stopTimer();
  timerHandle = setInterval(async () => {
    try {
      const start = Number(await game.roundStart());
      const dur   = Number(await game.duration());
      const end   = start + dur;
      const left  = Math.max(0, end - Math.floor(Date.now()/1000));
      const h = Math.floor(left/3600);
      const m = Math.floor((left%3600)/60);
      const s = left%60;
      const el = document.getElementById('countdown');
      if (el) {
        el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      }
      if (left === 0) stopTimer();
    } catch {}
  }, 1000);
}

export function stopTimer() {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
}
