export async function maybeShowTimer(gameContract) {
  try {
    const active = await gameContract.isRoundActive();
    if (!active) {
      hideTimer();
      return;
    }

    const start = await gameContract.roundStart();
    const duration = await gameContract.duration();
    const end = Number(start) + Number(duration);

    document.getElementById('timerContainer').style.display = 'block';

    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const left = Math.max(end - now, 0);
      document.getElementById('countdown').innerText =
        `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
    };

    tick();
    setInterval(tick, 1000);
  } catch (err) {
    console.error('⏱ Failed to load timer info:', err);
  }
}

function hideTimer() {
  const el = document.getElementById('timerContainer');
  if (el) el.style.display = 'none';
}
