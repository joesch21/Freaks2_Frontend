import abi from './abi/freakyFridayGameAbi.js';
import { FREAKY_CONTRACT, GCC_TOKEN, BSC_CHAIN_ID } from './frontendinfo.js';
import { startTimer, stopTimer } from './frontendtimer.js';
import erc20Abi from './erc20Abi.js';

let provider, signer, connectedAddress, game, gcc;

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

    wireUiAfterConnect();
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

function setOpenStatus(msg) {
  const el = document.getElementById('openStatus');
  if (el) el.textContent = msg || '';
}

async function refreshMode() {
  try {
    const mode = Number(await game.getRoundMode());
    const badge = document.getElementById('modeBadge');
    if (badge) badge.textContent = mode === 1 ? '💀 JACKPOT' : '🔮 Standard';
    const modeDisplay = document.getElementById('modeDisplay');
    if (modeDisplay) modeDisplay.textContent = mode === 1 ? 'Jackpot' : 'Standard Ritual';
  } catch (e) {
    console.error('mode fetch failed', e);
  }
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

    const timerEl = document.getElementById('timerContainer');
    if (active) {
      if (timerEl) timerEl.style.display = 'block';
      startTimer(game);
    } else {
      stopTimer();
      if (timerEl) timerEl.style.display = 'none';
    }

    await refreshMode();
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
    const [adm, rel] = await Promise.all([game.admin(), game.relayer()]);
    const me = connectedAddress?.toLowerCase();
    const show = [adm, rel].map(a => a?.toLowerCase?.()).includes(me);
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
  const isAdmin = await refreshAdminVisibility();
  if (!isAdmin) return;

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

function wireUiAfterConnect() {
  const w = document.getElementById('walletAddress');
  if (w) w.textContent = connectedAddress;
  wireJoin();
  wireAdmin();
  loadStep2State();
}

window.addEventListener('load', () => {
  const joinBtn = document.getElementById('btnJoin');
  if (joinBtn) joinBtn.disabled = true;
  ['connectBtnTop','connectBtnBottom'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', connectWallet);
  });
});
