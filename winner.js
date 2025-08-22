// winner.js
import { gameRead } from './frontendcore.js';

const $ = (id) => document.getElementById(id);
const ZERO = '0x0000000000000000000000000000000000000000';

function setWinnerUI(addr, round) {
  const box = $('lastWinnerContainer');
  const aEl = $('lastWinnerAddr');
  const rEl = $('lastWinnerRound');
  if (!box || !aEl || !rEl) return;

  if (!addr || addr === ZERO) {
    box.style.display = 'none';
    return;
  }
  aEl.textContent = `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  rEl.textContent = String(round);
  box.style.display = '';
}

// Fetch the last resolved round’s winner (no server storage needed)
export async function refreshLastWinner() {
  if (!gameRead) return;

  // ethers v6 returns BigInt for uint256
  const current = await gameRead.currentRound(); // BigInt
  if (current === 0n) { setWinnerUI(null, 0); return; }

  // If a round is active, the “last” resolved one is current-1
  const active = await gameRead.isRoundActive();
  const lastRound = active ? (current - 1n) : current;

  if (lastRound <= 0n) { setWinnerUI(null, 0); return; }

  // Direct contract read — no logs, no server
  const winner = await gameRead.winnerOfRound(lastRound);
  setWinnerUI(winner, lastRound);
}

// Live updates when a new round completes
export function subscribeLastWinner() {
  if (!gameRead) return;

  // RoundCompleted(address winner, uint256 round, uint256 prizePaid, uint256 refundPerPlayerFinal)
  gameRead.on('RoundCompleted', (winner, round, prizePaid, refundPerPlayerFinal) => {
    try {
      // round is BigInt in ethers v6
      setWinnerUI(winner, round);
    } catch (e) {
      console.warn('winner subscription update failed', e);
    }
  });
}
