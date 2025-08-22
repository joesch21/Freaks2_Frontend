// round-timer.js
import { ethers } from "ethers";
import gameAbi from "./abi/freakyFridayGameAbi.js";
import { FREAKY_CONTRACT } from "./frontendinfo.js";

// Flip to true if you want to block Join while roundStart == 0.
// Default false keeps "first join starts the round".
export const FF_GATE_JOIN_UNTIL_ACTIVE = false;

const $ = (id) => document.getElementById(id);
const fmt = (s) => s.toString().padStart(2, "0");
const hms = (secs) => {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return `${fmt(h)}:${fmt(m)}:${fmt(s)}`;
};

export async function initRoundTimer(joinBtnId = "joinBtn") {
  const provider = new ethers.BrowserProvider(window.ethereum);
  const game = new ethers.Contract(FREAKY_CONTRACT, gameAbi, provider);
  const joinBtn = document.getElementById(joinBtnId);
  const bar = $("ff-progress-bar"), label = $("ff-time-label"), left = $("countdown");

  async function refresh() {
    try {
      const [roundStartBN, durationBN] = await Promise.all([game.roundStart(), game.duration()]);
      const roundStart = Number(roundStartBN), duration = Number(durationBN), now = Math.floor(Date.now()/1000);

      if (roundStart === 0) {
        label && (label.textContent = "Round inactive");
        left && (left.textContent = "—");
        bar && (bar.style.width = "0%");
        if (FF_GATE_JOIN_UNTIL_ACTIVE && joinBtn) {
          joinBtn.classList.add("ff-join-disabled");
          joinBtn.title = "Round not started yet.";
        } else {
          joinBtn?.classList.remove("ff-join-disabled");
          if (joinBtn) joinBtn.title = "";
        }
        return;
      }

      const end = roundStart + duration;
      const remaining = Math.max(0, end - now);
      const elapsed = Math.max(0, Math.min(duration, now - roundStart));
      const pct = duration > 0 ? Math.min(100, Math.round((elapsed / duration) * 100)) : 0;

      label && (label.textContent = remaining > 0 ? "Round ends in:" : "Awaiting round close");
      left && (left.textContent = remaining > 0 ? hms(remaining) : "00:00:00");
      bar && (bar.style.width = `${pct}%`);

      if (joinBtn) {
        if (remaining <= 0) {
          joinBtn.classList.add("ff-join-disabled");
          joinBtn.title = "Round window ended; waiting for close.";
        } else {
          joinBtn.classList.remove("ff-join-disabled");
          joinBtn.title = "";
        }
      }
    } catch {}
  }

  await refresh();
  setInterval(refresh, 1000);
  game.on("Joined", refresh);
  game.on("RoundCompleted", refresh);

  // expose for unified-join preflight
  window.FF_GATE_JOIN_UNTIL_ACTIVE = FF_GATE_JOIN_UNTIL_ACTIVE;
}
