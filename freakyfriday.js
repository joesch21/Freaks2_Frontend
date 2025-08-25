// freakyfriday.js — GCC Freaky Friday (refactored)
//
// - Consistent IDs: gccBalance, bnbBalance, participantList, countdown
// - Updates both GCC & BNB balances
// - Attaches winner listener + backfill (RoundCompleted)
// - Separate approve/join flow with allowance checks
// - Chain guard for BSC mainnet (56)
// - Mobile deep link helper & robust UI handling

import { FREAKY_CONTRACT, GCC_TOKEN, FREAKY_RELAYER } from './frontendinfo.js';
import { connectWallet as coreConnectWallet, provider, gameContract, gccRead, gccWrite, userAddress as connectedAddr, gameRead, signer } from './frontendcore.js';
import { mountLastWinner } from './winner.js';
import { maybeShowTimer } from './frontendtimer.js';

// Minimal IERC20 ABI
const erc20 = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)"
];

function setStatus(msg, err) {
  const el = document.getElementById('status');
  if (el) {
    el.textContent = msg + (err?.message ? ` — ${err.message}` : '');
  }
}

// --- Environment detection ---
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const isMetaMaskInApp = navigator.userAgent.includes('MetaMaskMobile') || (window.ethereum?.isMetaMask === true);

function ensureInMetaMask() {
  if (!isMobile || isMetaMaskInApp) return false;
  sessionStorage.setItem('cameFromDeepLink', '1');
  const MM = `https://metamask.app.link/dapp/freaks2-frontend.onrender.com/`;
  window.location.href = MM;
  setTimeout(() => {
    if (!navigator.userAgent.includes('MetaMaskMobile') && !window.ethereum?.isMetaMask) {
      window.location.assign(MM);
    }
  }, 1200);
  return true;
}

function markConnectedUI() {
  for (const id of ['connectBtn', 'connectBtnLower']) {
    const btn = document.getElementById(id);
    if (btn) { btn.disabled = true; btn.textContent = 'Connected'; }
  }
}

function maybeShowDeeplink() {
  const isMob = /Android|iPhone|iPad/i.test(navigator.userAgent);
  const deeplink = document.getElementById('deeplink');
  const wrap = document.getElementById('metamaskLink');
  if (isMob && deeplink && wrap) {
    deeplink.href = 'https://metamask.app.link/dapp/freaks2-frontend.onrender.com';
    wrap.classList.remove('hidden');
  }
}

(function showMetaMaskHintOnce() {
  try {
    if (!isMetaMaskInApp) return;
    if (sessionStorage.getItem('cameFromDeepLink') === '1') {
      const mount = document.getElementById('mmHintMount') || document.body;
      const node = document.createElement('div');
      node.id = 'mmHint';
      node.className = 'mm-hint';
      node.textContent = "You're in MetaMask. Tap Connect again to activate your wallet.";
      mount.parentNode.insertBefore(node, mount.nextSibling);
      sessionStorage.removeItem('cameFromDeepLink');
      setTimeout(() => node.remove(), 6000);
    }
  } catch {}
})();

// -----------------------------------------------------------------------------
// Predicted winner helpers
//
// To display the winner of the most recently completed round without server
// storage, we query the RoundCompleted event logs directly from the chain.
// This avoids relying on any backend state.  After the user connects, we
// invoke loadPredictedWinner() to backfill the latest event and attach a
// listener for real‑time updates.  The UI elements involved are
// `<p id="winnerContainer">` containing `<span id="predictedWinner">`.  The
// winner bar at the top is handled separately via attachWinnerListenerLocal().

async function loadPredictedWinner() {
  try {
    // Ensure both the provider and gameContract are available (set on connect).
    if (!provider || !gameContract) return;
    // Build a filter for the RoundCompleted event.
    const filter = gameContract.filters.RoundCompleted();
    const toBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(1, toBlock - 200000);
    const logs = await gameContract.queryFilter(filter, fromBlock, toBlock);
    if (logs.length) {
      const last = logs[logs.length - 1];
      const winner = last.args?.winner;
      if (winner) {
        const cont   = document.getElementById('winnerContainer');
        const predEl = document.getElementById('predictedWinner');
        if (cont && predEl) {
          cont.style.display = '';
          predEl.innerText = winner;
        }
      }
    }
  } catch (e) {
    console.warn('loadPredictedWinner failed', e);
  }
}

function attachPredictedWinnerListener() {
  if (!gameContract) return;
  try {
    gameContract.on('RoundCompleted', (winner /* address */, round /* BigInt */, prizePaid, refundPerPlayerFinal) => {
      const cont   = document.getElementById('winnerContainer');
      const predEl = document.getElementById('predictedWinner');
      if (cont && predEl) {
        cont.style.display = '';
        predEl.innerText = winner;
      }
    });
  } catch (e) {
    console.warn('Predicted winner listener attach failed', e);
  }
}

let entryAmount;

/* ---------- Small DOM helpers ---------- */
const el = (id) => document.getElementById(id);
const text = (id, v) => { const e = el(id); if (e) e.innerText = v; };
const show = (id) => { const e = el(id); if (e) e.style.display = ''; };
const hide = (id) => { const e = el(id); if (e) e.style.display = 'none'; };
const short = (a) => (a ? `${a.slice(0,6)}…${a.slice(-4)}` : '');
const bscScanTx = (txHash) => `https://bscscan.com/tx/${txHash}`;
const showStatus = (lines) => {
  const s = el('status');
  if (s) s.innerHTML = Array.isArray(lines) ? lines.join('<br/>') : lines;
};

/* ---------- Mode + Last round ---------- */
async function getMode(game) {
  const m = await game.getRoundMode();
  return Number(m);
}

function applyThemeByMode(mode) {
  const badge = document.getElementById('modeBadge');
  const body = document.body;
  const modeText = document.getElementById('modeDisplay');
  if (mode === 1) {
    if (badge) badge.textContent = '💀 JACKPOT';
    body.classList.add('freaky-mode');
    if (modeText) modeText.textContent = 'Jackpot';
  } else {
    if (badge) badge.textContent = '🔮 Standard';
    body.classList.remove('freaky-mode');
    if (modeText) modeText.textContent = 'Standard Ritual';
  }
}

async function refreshModeUI(game) {
  try {
    const mode = await getMode(game);
    applyThemeByMode(mode);
  } catch (e) {
    console.error('refreshModeUI error', e);
  }
}

async function isAdminOrRelayer(game, me, relayerAddr) {
  try {
    const adminAddr = (await game.admin()).toLowerCase();
    const meL = (me || '').toLowerCase();
    const relL = (relayerAddr || '').toLowerCase();
    return meL === adminAddr || (!!relL && meL === relL);
  } catch {
    return false;
  }
}

async function refreshMaxPlayersUI(game) {
  const elCur = document.getElementById('apMaxPlayersCurrent');
  if (!elCur) return;
  try {
    const cur = await game.maxPlayers();
    elCur.textContent = String(cur);
  } catch (e) {
    console.error('maxPlayers() failed', e);
    elCur.textContent = '—';
  }
}

function setMaxPlayersStatus(msg) {
  const s = document.getElementById('apMaxPlayersStatus');
  if (s) s.textContent = msg || '';
}

function wireMaxPlayersControls(game) {
  const input = document.getElementById('apMaxPlayersInput');
  const btn   = document.getElementById('apMaxPlayersSave');
  if (!input || !btn || btn.dataset.wired === '1') return;

  btn.dataset.wired = '1';
  btn.addEventListener('click', async () => {
    try {
      const val = Number(input.value);
      if (!Number.isInteger(val) || val < 2) {
        setMaxPlayersStatus('Enter an integer ≥ 2.');
        return;
      }
      btn.disabled = true;
      setMaxPlayersStatus('Sending transaction…');
      const tx = await game.setMaxPlayers(val);
      setMaxPlayersStatus(`Tx: ${tx.hash}`);
      await tx.wait();
      setMaxPlayersStatus('✅ Updated');
      await refreshMaxPlayersUI(game);
    } catch (e) {
      console.error(e);
      setMaxPlayersStatus('❌ Failed to update (see console)');
    } finally {
      btn.disabled = false;
    }
  });
}

async function showAdminPanelIfAuthorized(game, signerAddr, relayerAddr) {
  try {
    const isAdmin = await isAdminOrRelayer(game, signerAddr, relayerAddr);
    const panel = document.getElementById('adminPanel');
    if (panel) panel.style.display = isAdmin ? 'block' : 'none';
    if (isAdmin) {
      await refreshMaxPlayersUI(game);
      wireMaxPlayersControls(game);
    }
    return isAdmin;
  } catch (e) {
    console.error('showAdminPanelIfAuthorized error', e);
    return false;
  }
}

function setAdminStatus(msg) {
  const el = document.getElementById('adminStatus');
  if (el) el.textContent = msg || '';
}

async function refreshRoundState(game) {
  try {
    const active = await game.isRoundActive();
    const stateEl = document.getElementById('roundState');
    const joinBtn = document.getElementById('joinBtn');

    if (active) {
      if (stateEl) stateEl.textContent = 'Round active';
      if (joinBtn) { joinBtn.disabled = false; joinBtn.title = ''; }
      document.getElementById('timerContainer')?.style?.setProperty('display','block');
    } else {
      if (stateEl) stateEl.textContent = 'Round inactive — waiting to open';
      if (joinBtn) { joinBtn.disabled = true; joinBtn.title = 'Round is not armed yet.'; }
      document.getElementById('timerContainer')?.style?.setProperty('display','none');
    }
  } catch (e) {
    console.error('refreshRoundState error', e);
  }
}

async function showAdminArmIfAuthorized(game, me, relayerAddr) {
  const isAdmin = await isAdminOrRelayer(game, me, relayerAddr);
  const panel = document.getElementById('adminArmPanel');
  if (panel) panel.style.display = isAdmin ? 'block' : 'none';
  return isAdmin;
}

function setArmStatus(msg) {
  const el = document.getElementById('adminArmStatus');
  if (el) el.textContent = msg || '';
}

async function armRound(game, me) {
  const tx = await game.relayedEnter(me);
  setArmStatus(`Arming… tx: ${tx.hash}`);
  await tx.wait();
  setArmStatus('✅ New round opened');
  await refreshRoundState(game);
  await maybeShowTimer(game);
}

async function getLastResolvedRound(g) {
  const cr = Number(await g.currentRound().catch(() => 0));
  for (let r = cr; r >= 1 && r >= cr - 3; r--) {
    const resolved = await g.roundResolved(r).catch(() => false);
    if (resolved) {
      const mode = Number(await g.roundModeAtClose(r).catch(() => 0));
      const winner = await g.winnerOfRound(r).catch(() => ethers.ZeroAddress);
      const refund = await g.refundPerPlayer(r).catch(() => 0n);
      const fnExists = typeof g.playersInRound === 'function';
      const players = fnExists ? Number(await g.playersInRound(r)) : 0;
      const entry = await g.entryAmount().catch(() => 50n * 10n**18n);
      const prize = (mode === 1) ? BigInt(players) * entry : BigInt(players) * (10n**18n);
      return { r, mode, winner, refund, prize };
    }
  }
  return null;
}

async function refreshLastRound() {
  try {
    const g = gameContract || gameRead;
    if (!g) return;
    const panel = document.getElementById('lastRoundPanel');
    const claimBtn = document.getElementById('lr_claim');
    const hint = document.getElementById('lr_hint');

    const last = await getLastResolvedRound(g);
    if (!last) {
      if (panel) panel.style.display = 'none';
      return;
    }
    if (panel) panel.style.display = 'block';

    document.getElementById('lr_round').textContent = String(last.r);
    document.getElementById('lr_mode').textContent = last.mode === 1 ? 'Jackpot' : 'Standard';
    document.getElementById('lr_winner').textContent = last.winner;
    document.getElementById('lr_prize').textContent = `${ethers.formatUnits(last.prize,18)} GCC`;
    document.getElementById('lr_refund').textContent = `${ethers.formatUnits(last.refund,18)} GCC`;

    let canClaim = false;
    const user = connectedAddr?.toLowerCase();
    if (user && last.mode === 0 && last.refund > 0n) {
      const joined = await g.hasJoinedThisRound(last.r, user).catch(()=>false);
      const claimed = await g.refundClaimed(last.r, user).catch(()=>true);
      canClaim = joined && !claimed;
    }
    if (claimBtn) {
      claimBtn.style.display = canClaim ? 'inline-block' : 'none';
      claimBtn.disabled = false;
      claimBtn.textContent = '💸 Claim refund';
      claimBtn.onclick = async () => {
        try {
          const tx = await g.claimRefund(last.r);
          claimBtn.disabled = true;
          claimBtn.textContent = 'Claiming...';
          await tx.wait();
          claimBtn.textContent = '✅ Claimed';
          await refreshLastRound();
        } catch (e) {
          console.error(e);
          claimBtn.disabled = false;
          claimBtn.textContent = '💸 Claim refund';
        }
      };
    }
    if (hint) hint.style.display = canClaim ? 'block' : 'none';
  } catch (e) {
    console.error('refreshLastRound error', e);
  }
}

/* ---------- Loader ---------- */
function showLoader(){ el('loader')?.classList?.remove('hidden'); }
function hideLoader(){ el('loader')?.classList?.add('hidden'); }

function showOverlay(msg) {
  const o = document.getElementById('overlay');
  const t = document.getElementById('overlayText');
  if (t) t.textContent = msg || 'Working…';
  if (o) o.style.display = 'grid';
}
function hideOverlay(){ const o=document.getElementById('overlay'); if(o) o.style.display='none'; }
function setStep2Error(msg){
  const e = el('step2Error');
  if (!e) return;
  if (!msg){ e.style.display = 'none'; e.textContent = ''; }
  else { e.style.display = 'block'; e.textContent = msg; }
}
function shortErr(e){
  return e?.shortMessage || e?.reason || e?.data?.message || e?.message || 'Unknown error';
}
async function refreshParticipants(){ document.getElementById('ff-refresh-participants')?.click(); }

async function loadStep2State() {
  const approveBtn = el('btnApproveOnly');
  const enterBtn = el('btnEnterOnly');
  const joinBtn = el('joinBtn');
  if (approveBtn) approveBtn.disabled = true;
  if (enterBtn) enterBtn.disabled = true;
  if (joinBtn) joinBtn.disabled = true;
  setStep2Error('');

  try {
    const net = await provider.getNetwork();
    if (Number(net?.chainId) !== 56) {
      setStep2Error('Wrong network, switch to BSC.');
      return;
    }

    entryAmount = await gameContract.entryAmount?.().catch(() => ethers.parseUnits('50', 18));

    const active = await gameContract.isRoundActive?.();
    if (!active) {
      if (joinBtn) { joinBtn.disabled = true; joinBtn.textContent = 'Round inactive'; }
      return;
    }

    const r = await gameContract.currentRound?.();
    const me = connectedAddr;
    const joined = await gameContract.hasJoinedThisRound?.(r, me);
    const joinedBadge = document.getElementById('ff-joined-badge');
    if (joinedBadge) joinedBadge.style.display = joined ? 'inline-flex' : 'none';
    const fnExists = typeof gameContract.playersInRound === 'function';
    const players = fnExists ? await gameContract.playersInRound(r) : null;
    const pc = document.getElementById('ff-player-count');
    if (pc && players !== null) pc.textContent = String(players);

    if (joined) {
      if (joinBtn) { joinBtn.disabled = true; joinBtn.textContent = 'You’re in ✅'; }
      return;
    }

    const balance = await gccRead.balanceOf(me);
    if (balance < entryAmount) {
      if (joinBtn) joinBtn.disabled = true;
      setStep2Error('Insufficient GCC balance');
      return;
    }

    const allowance = await gccRead.allowance(me, FREAKY_CONTRACT);
    if (approveBtn) approveBtn.disabled = allowance >= entryAmount;
    if (enterBtn) enterBtn.disabled = allowance < entryAmount;

    if (joinBtn) { joinBtn.disabled = false; joinBtn.textContent = 'Join the Ritual'; }

    attachWinnerListenerLocal();
    attachPredictedWinnerListener();
    attachRoundCompletedListener();
    await loadPredictedWinner();
  } catch (e) {
    console.error(e);
    setStep2Error('Network error, tap to retry.');
  }
}

/* ---------- Init ---------- */
async function initApp() {
  hideLoader();
  const approveBtn = el('btnApproveOnly');
  const joinBtn = el('joinBtn');
  const enterBtn = el('btnEnterOnly');

  if (approveBtn) approveBtn.disabled = true;
  if (joinBtn) joinBtn.disabled = true;
  if (enterBtn) enterBtn.disabled = true;

  maybeShowDeeplink();

  approveBtn?.addEventListener('click', approveOnly);
  enterBtn?.addEventListener('click', enterOnly);

  await refreshReadOnly();
}
document.addEventListener('DOMContentLoaded', initApp);

/* ---------- Chain guard ---------- */
async function ensureBscMainnet() {
  const hex = await window.ethereum.request({ method: 'eth_chainId' });
  if (hex !== '0x38') {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x38' }]
      });
    } catch (e) {
      if (e.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: '0x38',
            chainName: 'Binance Smart Chain Mainnet',
            nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
            rpcUrls: ['https://bsc-dataseed.binance.org/'],
            blockExplorerUrls: ['https://bscscan.com']
          }]
        });
      } else {
        throw new Error('Please switch to BSC Mainnet (chainId 56).');
      }
    }
  }
}

/* ---------- Connect flow ---------- */
export async function connectWallet() {
  // If not in MetaMask's in-app browser on mobile, deep-link and bail
  if (ensureInMetaMask()) return;
  try {
    if (!window.ethereum) {
      throw new Error('No Ethereum provider found.');
    }

    showLoader();
    await ensureBscMainnet();

    const { userAddress } = await coreConnectWallet();
    setStatus(`🔗 Connected: ${userAddress}`);
    text('walletAddress', userAddress);
    markConnectedUI();

      await mountLastWinner(provider);
      await refreshModeUI(gameContract);
      await refreshRoundState(gameContract);
      await maybeShowTimer(gameContract);
      gameContract.on('Joined', () => maybeShowTimer(gameContract));
      gameContract.on('RoundCompleted', () => maybeShowTimer(gameContract));
      const isAdmin = await showAdminArmIfAuthorized(
        gameContract,
        userAddress,
        FREAKY_RELAYER
      );
    await showAdminPanelIfAuthorized(
      gameContract,
      userAddress,
      FREAKY_RELAYER
    );

    if (isAdmin) {
      const btnStd = document.getElementById('btnModeStandard');
      const btnJp  = document.getElementById('btnModeJackpot');
      const armBtn = document.getElementById('btnArmRound');

      btnStd?.addEventListener('click', async () => {
        try {
          btnStd.disabled = btnJp.disabled = true;
          setAdminStatus('Switching to Standard…');
          const current = await getMode(gameContract);
          if (current !== 0) {
            const tx = await gameContract.setRoundMode(0);
            setAdminStatus(`Tx sent: ${tx.hash}`);
            await tx.wait();
          }
          await refreshModeUI(gameContract);
          setAdminStatus('✅ Mode is Standard');
        } catch (e) {
          console.error(e);
          setAdminStatus('❌ Failed to set Standard');
        } finally {
          btnStd.disabled = btnJp.disabled = false;
        }
      });

      btnJp?.addEventListener('click', async () => {
        try {
          btnStd.disabled = btnJp.disabled = true;
          setAdminStatus('Switching to Jackpot…');
          const current = await getMode(gameContract);
          if (current !== 1) {
            const tx = await gameContract.setRoundMode(1);
            setAdminStatus(`Tx sent: ${tx.hash}`);
            await tx.wait();
          }
          await refreshModeUI(gameContract);
          setAdminStatus('✅ Mode is JACKPOT');
        } catch (e) {
          console.error(e);
          setAdminStatus('❌ Failed to set Jackpot');
        } finally {
          btnStd.disabled = btnJp.disabled = false;
        }
      });

      armBtn?.addEventListener('click', async () => {
        try {
          const active = await gameContract.isRoundActive();
          if (active) { setArmStatus('Already active.'); return; }
          armBtn.disabled = true;
          await armRound(gameContract, userAddress);
        } catch (e) {
          console.error(e);
          setArmStatus('❌ Failed to open (check GCC balance/allowance).');
        } finally {
          armBtn.disabled = false;
        }
      });
    }

    await refreshLastRound();
      window.addEventListener('focus', async () => {
        const a = (await signer.getAddress?.().catch(() => null)) || connectedAddr;
        await refreshModeUI(gameContract);
        await showAdminPanelIfAuthorized(gameContract, a, FREAKY_RELAYER);
        await showAdminArmIfAuthorized(gameContract, a, FREAKY_RELAYER);
        await refreshRoundState(gameContract);
        await maybeShowTimer(gameContract);
        refreshLastRound();
      });
      if (window.ethereum) {
        window.ethereum.on?.('accountsChanged', async (accs) => {
          const a = accs?.[0] || null;
          await showAdminPanelIfAuthorized(gameContract, a, FREAKY_RELAYER);
          await showAdminArmIfAuthorized(gameContract, a, FREAKY_RELAYER);
          await refreshRoundState(gameContract);
          await maybeShowTimer(gameContract);
        });
        window.ethereum.on?.('chainChanged', async () => {
          const a = (await signer.getAddress?.().catch(() => null)) || null;
          await showAdminPanelIfAuthorized(gameContract, a, FREAKY_RELAYER);
          await showAdminArmIfAuthorized(gameContract, a, FREAKY_RELAYER);
          await refreshRoundState(gameContract);
          await maybeShowTimer(gameContract);
          await refreshModeUI(gameContract);
        });
      }
    await refreshAll();
    await loadStep2State();
      wireJoinButton({ provider, signer, gameContract });
  } catch (err) {
    console.error('Connect failed:', err);
    setStatus('❌ Connect failed', err);
  } finally {
    hideLoader();
  }
}

/* ---------- Join flows ---------- */
async function joinRitualOneClick(provider, signer, game) {
  const me = await signer.getAddress();
  const chainId = (await provider.getNetwork()).chainId;
  if (String(chainId) !== '56' && String(chainId) !== '97') {
    throw new Error('Wrong network — switch to BSC.');
  }

  const active = await game.isRoundActive();
  if (!active) throw new Error('Round inactive.');
  const round = await game.currentRound();
  const already = await game.hasJoinedThisRound(round, me);
  if (already) throw new Error('You already joined this round.');
  const entry = await game.entryAmount();

  const gcc = new ethers.Contract(GCC_TOKEN, erc20, signer);
  const allowance = await gcc.allowance(me, FREAKY_CONTRACT);
  if (allowance < entry) {
    showOverlay('Approving GCC…');
    const txA = await gcc.approve(FREAKY_CONTRACT, entry);
    await txA.wait();
  }

  showOverlay('Joining the ritual…');
  const tx = await game.enter();
  await tx.wait();
}

export function wireJoinButton({ provider, signer, gameContract }) {
  const btn = document.getElementById('joinBtn');
  if (!btn) return;
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      await joinRitualOneClick(provider, signer, gameContract);
      hideOverlay();
      await refreshParticipants();
      await refreshAll();
      await loadStep2State();
      btn.textContent = '✅ Joined';
    } catch (e) {
      hideOverlay();
      console.error('Join failed', e);
      btn.disabled = false;
      const status = document.getElementById('status');
      if (status) {
        status.innerHTML = `❌ Join failed — ${shortErr(e)} <a id="retryJoin" href="#">Retry</a>`;
        document.getElementById('retryJoin')?.addEventListener('click', (ev) => {
          ev.preventDefault();
          btn.click();
        });
      }
      setStep2Error(shortErr(e));
    }
  };
}

async function approveOnly() {
  setStep2Error('');
  try {
    showOverlay('Approving GCC…');
    const tx = await gccWrite.approve(FREAKY_CONTRACT, entryAmount);
    await tx.wait();
  } catch (e) {
    console.error(e);
    setStep2Error(shortErr(e));
  } finally {
    hideOverlay();
    await loadStep2State();
  }
}

async function enterOnly() {
  setStep2Error('');
  try {
    showOverlay('Joining the Ritual…');
    const tx = await gameContract.enter();
    await tx.wait();
    await refreshParticipants();
    await refreshAll();
  } catch (e) {
    console.error(e);
    setStep2Error(shortErr(e));
  } finally {
    hideOverlay();
    await loadStep2State();
  }
}

/* ---------- Read/UI helpers ---------- */
async function refreshAll() {
  await Promise.all([
    updateContractBalances(),
    refreshModeUI(gameContract || gameRead),
    refreshLastRound(),
    refreshRoundState(gameContract || gameRead),
    maybeShowTimer(gameContract || gameRead)
  ]);
}
async function refreshReadOnly() {
  await Promise.all([
    updateContractBalances(),
    refreshModeUI(gameContract || gameRead),
    refreshLastRound(),
    refreshRoundState(gameContract || gameRead),
    maybeShowTimer(gameContract || gameRead)
  ]);
}

// helper
function setTextAny(ids, value){
  for (const id of ids){
    const e = document.getElementById(id);
    if (e) { e.innerText = value; return true; }
  }
  console.warn('Missing balance element for ids:', ids);
  return false;
}

async function updateContractBalances() {
  try {
    const src = gameContract || gameRead;
    // Read token balance from the contract via view function instead of reading
    // directly from the token.  This accounts for escrowed/refundable amounts.
    const gccBal = await src.getContractTokenBalance();
    setTextAny(['gccBalance'], `${ethers.formatUnits(gccBal, 18)} GCC`);

    const bnbBal = await src.checkBNBBalance();
    setTextAny(['bnbBalance'], `${ethers.formatUnits(bnbBal, 18)} BNB`);
  } catch (e) {
    console.warn('Balance load failed', e);
    setStatus('⚠️ Failed to load balances', e);
  }
}

/* ---------- Last round info + refund eligibility ---------- */

/* ---------- Last winner display ---------- */

/* ---------- Winner banner (local listener + backfill) ---------- */
function attachWinnerListenerLocal() {
  if (!gameContract) return;

  // Live event
  try {
    gameContract.on('RoundCompleted', (winner, round, prizePaid, refundPerPlayerFinal, ev) => {
      const tx = ev?.log?.transactionHash ?? null;
      if (el('winnerAddr')) el('winnerAddr').textContent = `${short(winner)} (Round ${Number(round)})`;
      if (tx && el('winnerTxLink')) { el('winnerTxLink').href = bscScanTx(tx); el('winnerTxLink').style.display = ''; }
      show('winnerBar');
    });
  } catch (e) {
    console.warn('Winner listener attach failed', e);
  }

  // Backfill last winner on load
  (async () => {
    try {
      const filter = gameContract.filters.RoundCompleted();
      const events = await gameContract.queryFilter(filter, -5000);
      if (events.length) {
        const last = events[events.length - 1];
        const [winner, round] = last.args;
        const tx = last?.log?.transactionHash ?? null;
        if (el('winnerAddr')) el('winnerAddr').textContent = `${short(winner)} (Round ${Number(round)})`;
        if (tx && el('winnerTxLink')) { el('winnerTxLink').href = bscScanTx(tx); el('winnerTxLink').style.display = ''; }
        show('winnerBar');
      }
    } catch (e) {
      // silent
    }
  })();
}

function attachRoundCompletedListener() {
  if (!gameContract) return;

    const update = async () => {
      const a = (await signer.getAddress?.().catch(() => null)) || connectedAddr;
      await refreshModeUI(gameContract);
      await showAdminPanelIfAuthorized(gameContract, a, FREAKY_RELAYER);
      await showAdminArmIfAuthorized(gameContract, a, FREAKY_RELAYER);
      await refreshRoundState(gameContract);
      await maybeShowTimer(gameContract);
      refreshLastRound();
    };

  try {
    gameContract.on('RoundCompleted', update);
  } catch (e) {
    console.warn('RoundCompleted listener setup failed', e);
  }

  (async () => {
    try {
      const filter = gameContract.filters.RoundCompleted();
        const events = await gameContract.queryFilter(filter, -5000);
        if (events.length) {
          const a = (await signer.getAddress?.().catch(() => null)) || connectedAddr;
          await refreshModeUI(gameContract);
          await showAdminPanelIfAuthorized(gameContract, a, FREAKY_RELAYER);
          await showAdminArmIfAuthorized(gameContract, a, FREAKY_RELAYER);
          await refreshLastRound();
          await refreshRoundState(gameContract);
          await maybeShowTimer(gameContract);
        }
      } catch (e) {
        // silent
      }
    })();
}

setInterval(() => {
  const g = gameContract || gameRead;
  if (g) refreshRoundState(g);
}, 15000);

// --- Event wiring for connect / deeplink buttons ---
const openInMMTop = document.getElementById('openInMMTop');
if (openInMMTop) {
  openInMMTop.addEventListener('click', (e) => {
    e.preventDefault();
    ensureInMetaMask();
  });
}

document.getElementById('connectBtn')?.addEventListener('click', connectWallet);
document.getElementById('connectBtnLower')?.addEventListener('click', connectWallet);

document.getElementById('deeplink')?.addEventListener('click', (e) => {
  e.preventDefault();
  ensureInMetaMask();
});

