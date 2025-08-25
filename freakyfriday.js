import abi from './abi/freakyFridayGameAbi.js';
import { FREAKY_CONTRACT, GCC_TOKEN, FREAKY_RELAYER, BSC_CHAIN_ID } from './frontendinfo.js';
import { startTimer, stopTimer } from './frontendtimer.js';
import erc20Abi from './erc20Abi.js';

let provider, signer, connectedAddress, game, gcc;

function hasFn(contract, name) {
  return contract && typeof contract[name] === 'function';
}

function shortErr(e) {
  return (e?.reason || e?.shortMessage || e?.message || 'Unknown error').split('\n')[0].slice(0, 160);
}

function showError(msg) {
  const el = document.getElementById('step2Error');
  if (el) {
    el.style.display = 'block';
    el.innerHTML = `${msg} <button id="retryStep2">Retry</button>`;
    const btn = document.getElementById('retryStep2');
    if (btn) btn.onclick = loadStep2State;
  }
}

function setConnectButtonsEnabled(on) {
  ['connectBtnTop','connectBtnBottom'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.disabled = !on;
  });
}

function toggleOverlay(on, text) {
  const o = document.getElementById('overlay');
  const t = document.getElementById('overlayText');
  if (o) o.style.display = on ? 'block' : 'none';
  if (t && text) t.textContent = text;
}

async function connectWallet() {
  setConnectButtonsEnabled(false);
  try {
    if (!window.ethereum) {
      window.location.href = 'https://metamask.app.link/dapp/freaks2-frontend.onrender.com';
      return;
    }
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send('eth_requestAccounts', []);
    signer = await provider.getSigner();
    connectedAddress = (await signer.getAddress()).toLowerCase();

    game = new ethers.Contract(FREAKY_CONTRACT, abi, signer);
    gcc  = new ethers.Contract(GCC_TOKEN, erc20Abi, signer);

    const net = await provider.getNetwork();
    if (Number(net.chainId) !== BSC_CHAIN_ID) {
      showError('Wrong network: please switch to BSC');
    }

    await wireUiAfterConnect();
  } catch (e) {
    console.error('connectWallet failed', e);
    showError(shortErr(e));
  } finally {
    setConnectButtonsEnabled(true);
  }
}

async function ensureChain() {
  const net = await (new ethers.BrowserProvider(window.ethereum)).getNetwork();
  if (Number(net.chainId) !== BSC_CHAIN_ID) {
    throw new Error(`Wrong network: connect to BSC (chainId ${BSC_CHAIN_ID}).`);
  }
}

function setMsg(id, text, cls='') {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('error','success');
  if (cls) el.classList.add(cls);
  el.textContent = text || '';
}

async function getEntryAmount(game) {
  const amt = await game.entryAmount();
  return BigInt(amt.toString());
}

async function getBalances(game, signer, gcc, addr) {
  const [need, bal, allowance] = await Promise.all([
    getEntryAmount(game),
    gcc.balanceOf(addr),
    gcc.allowance(addr, FREAKY_CONTRACT),
  ]);
  return { need: BigInt(need), bal: BigInt(bal), allowance: BigInt(allowance) };
}

async function getLastResolvedRound(game) {
  if (!hasFn(game, 'currentRound') || !hasFn(game, 'roundResolved')) return null;
  const cr = Number(await game.currentRound());
  for (let r = Math.max(1, cr); r >= Math.max(1, cr - 3); r--) {
    const resolved = await game.roundResolved(r).catch(() => false);
    if (resolved) {
      const mode   = hasFn(game, 'roundModeAtClose') ? Number(await game.roundModeAtClose(r).catch(() => 0)) : 0;
      const winner = hasFn(game, 'winnerOfRound')    ? await game.winnerOfRound(r).catch(() => ethers.ZeroAddress) : ethers.ZeroAddress;
      const refund = hasFn(game, 'refundPerPlayer')  ? await game.refundPerPlayer(r).catch(() => 0n) : 0n;

      let prize = 0n;
      if (hasFn(game, 'playersInRound')) {
        const players = BigInt(await game.playersInRound(r).catch(() => 0));
        const entry   = hasFn(game, 'entryAmount') ? BigInt(await game.entryAmount().catch(() => 0)) : 0n;
        prize = (mode === 1) ? players * entry : players * (10n ** 18n);
      }
      return { round: r, mode, winner, refundPerPlayer: refund, prizePaid: prize };
    }
  }
  return null;
}

async function refreshLastRoundUI(game, userAddr) {
  const box = document.getElementById('lastRound');
  const errEl = document.getElementById('lastRoundError');
  if (!box || !errEl) return;
  errEl.style.display = 'none';
  errEl.textContent = '';

  try {
    const last = await getLastResolvedRound(game);
    if (!last) { box.style.display = 'none'; return; }

    const { round, mode, winner, prizePaid, refundPerPlayer } = last;
    box.style.display = 'block';
    document.getElementById('lastRoundNo').textContent = String(round);
    document.getElementById('lastMode').textContent = (mode === 1) ? 'Jackpot' : 'Standard';
    document.getElementById('lastWinner').textContent = winner;
    document.getElementById('lastPrize').textContent = prizePaid ? `${ethers.formatUnits(prizePaid,18)} GCC` : '—';
    document.getElementById('lastRefund').textContent = refundPerPlayer ? `${ethers.formatUnits(refundPerPlayer,18)} GCC` : '—';

    const canShow =
      hasFn(game, 'hasJoinedThisRound') &&
      hasFn(game, 'refundClaimed') &&
      hasFn(game, 'claimRefund');

    const btn = document.getElementById('claimRefundBtn');
    if (!canShow || !userAddr) {
      if (btn) btn.style.display = 'none';
      return;
    }

    const joined  = await game.hasJoinedThisRound(round, userAddr).catch(() => false);
    const claimed = await game.refundClaimed(round, userAddr).catch(() => true);
    const refundable = (refundPerPlayer || 0n) > 0n;

    const showBtn = joined && !claimed && refundable && mode === 0;
    if (btn) {
      btn.style.display = showBtn ? 'inline-block' : 'none';
      if (showBtn) {
        btn.onclick = async () => {
          try {
            btn.disabled = true;
            const tx = await game.claimRefund(round);
            await tx.wait();
            await refreshLastRoundUI(game, userAddr);
          } catch (e) {
            console.error('claimRefund failed', e);
            errEl.style.display = 'block';
            errEl.textContent = e?.reason || e?.shortMessage || e?.message || 'Refund failed';
          } finally {
            btn.disabled = false;
          }
        };
      }
    }
  } catch (e) {
    console.error('refreshLastRoundUI error', e);
    errEl.style.display = 'block';
    errEl.textContent = e?.reason || e?.shortMessage || e?.message || 'Last round load failed';
  }
}

function setOpenStatus(msg) {
  const el = document.getElementById('openStatus');
  if (el) el.textContent = msg || '';
}

async function readMode(game) {
  if (typeof game.getRoundMode === 'function') {
    return Number(await game.getRoundMode());
  }
  if (typeof game.roundMode === 'function') {
    return Number(await game.roundMode());
  }
  throw new Error('Mode getters missing in ABI');
}

function paintMode(mode) {
  const badge = document.getElementById('modeBadge');
  const body  = document.body;
  if (!badge) return;
  if (mode === 1) {
    badge.textContent = '💀 JACKPOT';
    body.classList.add('freaky-mode');
  } else {
    badge.textContent = '🔮 Standard';
    body.classList.remove('freaky-mode');
  }
  const modeDisplay = document.getElementById('modeDisplay');
  if (modeDisplay) modeDisplay.textContent = mode === 1 ? 'Jackpot' : 'Standard Ritual';
}

async function refreshMode(game) {
  try { paintMode(await readMode(game)); }
  catch (e) { console.error('Mode read failed', e); }
}

async function canSeeAdmin(game, myAddr, relayerAddr) {
  try {
    const admin = (await game.admin()).toLowerCase();
    const me    = (myAddr||'').toLowerCase();
    const rel   = (relayerAddr||'').toLowerCase();
    return me === admin || (rel && me === rel);
  } catch (e) {
    console.error('admin() read failed', e);
    return false;
  }
}

function setAdminStatus(msg) {
  const el = document.getElementById('adminStatus');
  if (el) el.textContent = msg || '';
}

async function loadStep2State() {
  try {
    const errEl = document.getElementById('step2Error');
    if (errEl) { errEl.style.display = 'none'; errEl.innerHTML = ''; }
    const btn = document.getElementById('btnJoin');
    if (btn) btn.disabled = true;
    setMsg('step2Msg', 'Loading…');

    await ensureChain();

    const round = await game.currentRound();
    const [active, need, joined, allowance] = await Promise.all([
      game.isRoundActive(),
      game.entryAmount(),
      game.hasJoinedThisRound(round, connectedAddress),
      gcc.allowance(connectedAddress, FREAKY_CONTRACT),
    ]);

    await refreshLastRoundUI(game, connectedAddress);

    const timerEl = document.getElementById('timerContainer');
    if (active) {
      if (timerEl) timerEl.style.display = 'block';
      startTimer(game);
    } else {
      stopTimer();
      if (timerEl) timerEl.style.display = 'none';
    }

    await refreshMode(game);
    await refreshAdminVisibility();
    await refreshMaxPlayers();

    if (!active) {
      setMsg('step2Msg', 'Round inactive — waiting to open');
      return;
    }

    if (joined) {
      setMsg('step2Msg', "You're in", 'success');
      return;
    }

    setMsg('step2Msg', '');
    if (btn) btn.disabled = false;
  } catch (e) {
    console.error('loadStep2State failed', e);
    showError(shortErr(e));
  }
}

async function wireJoin() {
  const btn = document.getElementById('btnJoin');
  const msgId = 'step2Msg';
  if (!btn) return;
  btn.onclick = async () => {
    btn.disabled = true;
    setMsg(msgId, 'Checking…');
    try {
      await ensureChain();

      const active = await game.isRoundActive();
      if (!active) { setMsg(msgId, 'Round inactive.', 'error'); return; }

      const round = Number(await game.currentRound());
      const already = await game.hasJoinedThisRound(round, connectedAddress);
      if (already) { setMsg(msgId, 'You already joined.', 'success'); return; }

      const need = BigInt(await game.entryAmount());
      const allow = await gcc.allowance(connectedAddress, FREAKY_CONTRACT);

      if (allow < need) {
        setMsg(msgId, 'Approving GCC…');
        toggleOverlay(true, 'Approving GCC…');
        const txA = await gcc.approve(FREAKY_CONTRACT, need);
        await txA.wait();
        toggleOverlay(false);
      }

      setMsg(msgId, 'Joining…');
      toggleOverlay(true, 'Joining…');
      const txE = await game.enter();
      await txE.wait();
      toggleOverlay(false);

      setMsg(msgId, '✅ Joined!', 'success');
      await loadStep2State();
    } catch (e) {
      console.error('Join flow failed', e);
      showError(`Join failed — ${shortErr(e)}`);
    } finally {
      toggleOverlay(false);
      btn.disabled = false;
    }
  };
}

async function refreshAdminVisibility() {
  try {
    const show = await canSeeAdmin(game, connectedAddress, FREAKY_RELAYER);
    const panel = document.getElementById('adminPanel');
    if (panel) panel.style.display = show ? 'block' : 'none';
    return show;
  } catch (e) {
    console.error('admin check failed', e);
    const panel = document.getElementById('adminPanel');
    if (panel) panel.style.display = 'none';
    return false;
  }
}

async function refreshMaxPlayers() {
  try {
    const cur = Number(await game.maxPlayers());
    const span = document.getElementById('maxPlayersCurrent');
    if (span) span.textContent = String(cur);
  } catch {}
}

async function wireAdmin() {
  const show = await refreshAdminVisibility();
  if (!show) return;

  const btnStd = document.getElementById('btnModeStandard');
  const btnJp  = document.getElementById('btnModeJackpot');
  if (btnStd && btnJp) {
    btnStd.addEventListener('click', async () => {
      try {
        btnStd.disabled = btnJp.disabled = true;
        setAdminStatus('Switching to Standard…');
        const cur = await readMode(game);
        if (cur !== 0) {
          const tx = await game.setRoundMode(0);
          setAdminStatus(`Tx sent: ${tx.hash}`);
          await tx.wait();
        }
        await refreshMode(game);
        setAdminStatus('✅ Mode is Standard');
      } catch (e) {
        console.error(e);
        setAdminStatus(`❌ Failed: ${e?.shortMessage || e?.reason || e?.message || 'Unknown error'}`);
      } finally {
        btnStd.disabled = btnJp.disabled = false;
      }
    });

    btnJp.addEventListener('click', async () => {
      try {
        btnStd.disabled = btnJp.disabled = true;
        setAdminStatus('Switching to Jackpot…');
        const cur = await readMode(game);
        if (cur !== 1) {
          const tx = await game.setRoundMode(1);
          setAdminStatus(`Tx sent: ${tx.hash}`);
          await tx.wait();
        }
        await refreshMode(game);
        setAdminStatus('✅ Mode is JACKPOT');
      } catch (e) {
        console.error(e);
        setAdminStatus(`❌ Failed: ${e?.shortMessage || e?.reason || e?.message || 'Unknown error'}`);
      } finally {
        btnStd.disabled = btnJp.disabled = false;
      }
    });
  }

  await refreshMaxPlayers();

  const btnOpen = document.getElementById('btnOpenRound');
  if (btnOpen) {
    btnOpen.onclick = async () => {
      try {
        btnOpen.disabled = true;
        setOpenStatus('Checking balance & allowance…');

        const me = connectedAddress;
        const [adminAddr, relayerAddr] = await Promise.all([game.admin(), game.relayer()]);
        const isAdminAddr = [adminAddr, relayerAddr].map(a => a?.toLowerCase()).includes(me.toLowerCase());
        if (!isAdminAddr) { setOpenStatus('Not authorized.'); return; }

        const active = await game.isRoundActive();
        if (active) { setOpenStatus('Already active.'); return; }

        const { need, bal, allowance } = await getBalances(game, signer, gcc, me);

        if (bal < need) { setOpenStatus('Insufficient GCC balance to open a round.'); return; }

        if (allowance < need) {
          setOpenStatus('Approving GCC…');
          toggleOverlay(true, 'Approving GCC…');
          const tx1 = await gcc.approve(FREAKY_CONTRACT, need);
          await tx1.wait();
          toggleOverlay(false);
        }

        setOpenStatus('Opening round…');
        toggleOverlay(true, 'Opening round…');
        const tx2 = await game.relayedEnter(me);
        setOpenStatus(`Tx sent: ${tx2.hash} (waiting)…`);
        await tx2.wait();
        toggleOverlay(false);

        setOpenStatus('✅ Round opened!');
        await loadStep2State();
      } catch (e) {
        console.error('Open round failed', e);
        setOpenStatus(`❌ Failed to open — ${e.reason || e.shortMessage || e.message}`);
      } finally {
        toggleOverlay(false);
        btnOpen.disabled = false;
      }
    };
  }

  const btnSave = document.getElementById('btnSaveMax');
  if (btnSave) {
    btnSave.onclick = async () => {
      const msgId = 'maxPlayersMsg';
      const val = Number(document.getElementById('maxPlayersInput').value);
      if (!Number.isFinite(val) || val < 2) {
        setMsg(msgId, 'Enter a number ≥ 2', 'error');
        return;
      }
      setMsg(msgId, 'Saving…');
      try {
        const tx = await game.setMaxPlayers(val);
        await tx.wait();
        setMsg(msgId, '✅ Updated', 'success');
        await refreshMaxPlayers();
      } catch (e) {
        console.error('setMaxPlayers failed', e);
        setMsg(msgId, `❌ Save failed — ${shortErr(e)}`, 'error');
      }
    };
  }
}

async function wireUiAfterConnect() {
  const w = document.getElementById('walletAddress');
  if (w) w.textContent = connectedAddress;
  await refreshMode(game);
  wireJoin();
  wireAdmin();
  await loadStep2State();
}

window.addEventListener('load', () => {
  const joinBtn = document.getElementById('btnJoin');
  if (joinBtn) joinBtn.disabled = true;
  ['connectBtnTop','connectBtnBottom'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', connectWallet);
  });
});
