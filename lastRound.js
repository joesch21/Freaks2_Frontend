import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@6.10.0/dist/ethers.min.js';

export async function refreshModeAndLastRound(game, user) {
  try {
    // Mode badge (0: Standard, 1: Jackpot)
    if (typeof game.getRoundMode === 'function') {
      const m = Number(await game.getRoundMode());
      setText('modeBadge', m === 1 ? '💀 JACKPOT' : '🔮 STANDARD');
    }

    const last = await getLastResolvedRound(game);
    const wrap = byId('lastRound');
    if (!last) { if (wrap) wrap.style.display = 'none'; return; }

    const { round, mode, winner, prizePaid, refundPerPlayer } = last;

    wrap.style.display = 'block';
    setText('lastRoundNo', String(round));
    setText('lastMode', mode === 1 ? 'Jackpot' : 'Standard');
    setText('lastWinner', winner);
    setText('lastPrize', fmt(prizePaid));
    setText('lastRefund', fmt(refundPerPlayer));

    // Show claim button if the connected user joined and hasn't claimed (Standard only)
    let showClaim = false;
    if (user && mode === 0) {
      const joined = await game.hasJoinedThisRound(round, user).catch(()=>false);
      const already = await game.refundClaimed(round, user).catch(()=>true);
      showClaim = joined && !already && refundPerPlayer > 0n;
    }
    const btn = byId('claimRefundBtn');
    if (btn) btn.style.display = showClaim ? 'inline-block' : 'none';
  } catch (e) {
    console.error('refreshModeAndLastRound error', e);
  }
}

export function wireClaim(game, getUserAddress, setStatus) {
  const btn = byId('claimRefundBtn');
  if (!btn) return;
  btn.onclick = async () => {
    try {
      const last = await getLastResolvedRound(game);
      if (!last) return;
      const tx = await game.claimRefund(last.round);
      if (setStatus) setStatus(`Claiming refund… ${tx.hash}`);
      await tx.wait();
      if (setStatus) setStatus('✅ Refund claimed');
      const user = await getUserAddress();
      await refreshModeAndLastRound(game, user);
    } catch (e) {
      console.error(e);
      if (setStatus) setStatus('❌ Claim failed (see console)');
    }
  };
}

async function getLastResolvedRound(game) {
  const cr = Number(await game.currentRound().catch(()=>0));
  for (let r = cr; r >= 1 && r >= cr - 3; r--) {
    const resolved = await game.roundResolved(r).catch(()=>false);
    if (resolved) {
      const mode   = Number(await game.roundModeAtClose(r).catch(()=>0));
      const winner = await game.winnerOfRound(r).catch(()=>ethers.ZeroAddress);
      const refund = await game.refundPerPlayer(r).catch(()=>0n);
      // prizePaid may not be stored; compute from entry * players
      const players = Number(await game.playersInRound(r).catch(()=>0));
      const entry   = await game.entryAmount().catch(()=>50n * 10n ** 18n);
      const prize   = BigInt(players) * entry;
      return { round: r, mode, winner, refundPerPlayer: refund, prizePaid: prize };
    }
  }
  return null;
}

function byId(id){ return document.getElementById(id); }
function setText(id, txt){ const el = byId(id); if (el) el.textContent = txt; }
function fmt(v18){ return `${ethers.formatUnits(v18, 18)} GCC`; }
