import abi from './abi/freakyFridayGameAbi.js';
import { FREAKY_CONTRACT, GCC_TOKEN, BSC_CHAIN_ID } from './frontendinfo.js';
import { startTimer, stopTimer } from './frontendtimer.js';

let provider, signer, account, game, gcc;

async function init() {
  if (!window.ethereum) return;
  provider = new ethers.BrowserProvider(window.ethereum, 'any');
  await provider.send('eth_requestAccounts', []);
  await ensureChain();
  signer = await provider.getSigner();
  account = await signer.getAddress();
  game = new ethers.Contract(FREAKY_CONTRACT, abi, signer);
  gcc  = new ethers.Contract(GCC_TOKEN, [
    "function approve(address spender, uint256 value) external returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function decimals() view returns (uint8)"
  ], signer);

  await paintModeAndState();
  wireJoin();
  wireAdmin();
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

async function paintModeAndState() {
  try {
    const active = await game.isRoundActive();
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
  } catch (e) {
    console.error('paint state failed', e);
  }
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

function showRetry(msgId, fn) {
  const el = document.getElementById(msgId);
  if (!el) return;
  const btn = document.createElement('button');
  btn.textContent = 'Retry';
  btn.style.marginLeft = '.5rem';
  btn.onclick = () => { el.textContent = ''; fn(); };
  el.appendChild(btn);
}

function friendlyError(e) {
  const s = (e?.info?.error?.message || e?.shortMessage || e?.message || '').toString();
  if (/insufficient allowance|allowance/i.test(s)) return 'allowance too low';
  if (/user rejected|denied/i.test(s)) return 'user rejected';
  if (/wrong network|chain/i.test(s)) return 'wrong network';
  if (/already|joined/i.test(s)) return 'already joined';
  return s || 'network error';
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
      const already = await game.hasJoinedThisRound(round, account);
      if (already) { setMsg(msgId, 'You already joined.', 'success'); return; }

      const need = BigInt(await game.entryAmount());
      const allow = await gcc.allowance(account, FREAKY_CONTRACT);

      if (allow < need) {
        setMsg(msgId, 'Approving GCC…');
        const txA = await gcc.approve(FREAKY_CONTRACT, need);
        await txA.wait();
      }

      setMsg(msgId, 'Joining…');
      const txE = await game.enter();
      await txE.wait();

      setMsg(msgId, '✅ Joined!', 'success');
      await paintModeAndState();
    } catch (e) {
      console.error('Join flow failed', e);
      const reason = friendlyError(e);
      setMsg(msgId, `❌ Join failed — ${reason}`, 'error');
      showRetry(msgId, wireJoin);
    } finally {
      btn.disabled = false;
    }
  };
}

async function refreshAdminVisibility() {
  try {
    const [adm, rel] = await Promise.all([game.admin(), game.relayer()]);
    const me = account?.toLowerCase();
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
      const msgId = 'openRoundMsg';
      setMsg(msgId, 'Opening…');
      try {
        const active = await game.isRoundActive();
        if (active) { setMsg(msgId, 'Already active.', 'success'); return; }

        const need  = BigInt(await game.entryAmount());
        const allow = await gcc.allowance(account, FREAKY_CONTRACT);
        if (allow < need) {
          const txA = await gcc.approve(FREAKY_CONTRACT, need);
          await txA.wait();
        }

        const tx = await game.relayedEnter(account);
        await tx.wait();
        setMsg(msgId, '✅ Round opened.', 'success');
        await paintModeAndState();
      } catch (e) {
        console.error('Open round failed', e);
        setMsg(msgId, `❌ Failed to open (${friendlyError(e)}).`, 'error');
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
        setMsg(msgId, `❌ Save failed — ${friendlyError(e)}`, 'error');
      }
    };
  }
}

window.addEventListener('load', init);
