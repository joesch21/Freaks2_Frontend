// freakyfriday.js — GCC Freaky Friday (refactored)
//
// - Consistent IDs: gccBalance, bnbBalance, participantList, countdown
// - Updates both GCC & BNB balances
// - Attaches winner listener + backfill (RoundCompleted)
// - Separate approve/join flow with allowance checks
// - Chain guard for BSC mainnet (56)
// - Mobile deep link helper & robust UI handling

import { FREAKY_CONTRACT, BACKEND_URL, FREAKY_RELAYER, REQUIRED_CHAIN_ID } from './frontendinfo.js';
import { connectWallet as coreConnectWallet, setStatus, provider, gameContract, gccRead, gccWrite, userAddress as connectedAddr, gameRead, signer } from './frontendcore.js';
import { mountLastWinner } from './winner.js';

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
async function isAdminOrRelayer(game, addr) {
  if (!addr) return false;
  try {
    const admin = await game.admin();
    if (admin && admin.toLowerCase() === addr.toLowerCase()) return true;
  } catch {}
  try {
    if (typeof FREAKY_RELAYER !== 'undefined' &&
        FREAKY_RELAYER.toLowerCase() === addr.toLowerCase()) return true;
  } catch {}
  return false;
}

function applyThemeForMode(modeNum) {
  const body = document.body;
  const badge = document.getElementById('modeBadge');
  const switchEl = document.getElementById('freakySwitch');
  const label = document.getElementById('freakySwitchLabel');
  const modeText = document.getElementById('modeDisplay');

  const isJackpot = Number(modeNum) === 1;
  if (badge) badge.textContent = isJackpot ? '💀 JACKPOT' : '🔮 STANDARD';
  body.classList.toggle('freaky', isJackpot);
  if (switchEl) switchEl.checked = isJackpot;
  if (label) label.textContent = isJackpot ? 'Jackpot' : 'Standard';
  if (modeText) modeText.textContent = isJackpot ? 'Jackpot' : 'Standard Ritual';
}

async function refreshModeUI(game, userAddr) {
  try {
    if (typeof game?.getRoundMode === 'function') {
      const modeNum = await game.getRoundMode();
      applyThemeForMode(modeNum);
    }

    const adminToggle = document.getElementById('adminModeToggle');
    if (adminToggle) {
      const canAdmin = await isAdminOrRelayer(game, userAddr);
      adminToggle.classList.toggle('hidden', !canAdmin);
    }
  } catch (e) {
    console.error('refreshModeUI error', e);
  }
}

async function ensureChain(provider) {
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== REQUIRED_CHAIN_ID) {
    alert('Please switch to BSC mainnet to change mode.');
    throw new Error('Wrong chain');
  }
}

function wireAdminSwitch(game, signer) {
  const input = document.getElementById('freakySwitch');
  if (!input) return;
  input.addEventListener('change', async (e) => {
    try {
      const isJackpot = e.target.checked;
      const modeVal = isJackpot ? 1 : 0;
      const addr = await signer.getAddress();
      if (!(await isAdminOrRelayer(game, addr))) {
        e.target.checked = !isJackpot;
        return alert('Only admin/relayer can change mode.');
      }
      await ensureChain(provider);
      const tx = await game.setRoundMode(modeVal);
      await tx.wait();
      const newMode = await game.getRoundMode();
      applyThemeForMode(newMode);
    } catch (err) {
      console.error(err);
      e.target.checked = !e.target.checked;
      alert('Failed to change mode. See console.');
    }
  });
}

async function getLastResolvedRound(g) {
  const cr = Number(await g.currentRound().catch(() => 0));
  for (let r = cr; r >= 1 && r >= cr - 3; r--) {
    const resolved = await g.roundResolved(r).catch(() => false);
    if (resolved) {
      const mode = Number(await g.roundModeAtClose(r).catch(() => 0));
      const winner = await g.winnerOfRound(r).catch(() => ethers.ZeroAddress);
      const refund = await g.refundPerPlayer(r).catch(() => 0n);
      const players = Number(await g.playersInRound(r).catch(() => 0));
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

async function waitForAllowance(addr) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    const a = await gccRead.allowance(addr, FREAKY_CONTRACT);
    if (a >= entryAmount) return true;
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

/* ---------- Init ---------- */
async function initApp() {
  hideLoader();
  const approveBtn = el('approveBtn');
  const joinBtn = el('joinBtn');

  if (approveBtn) approveBtn.disabled = true;
  if (joinBtn) joinBtn.disabled = true;

  maybeShowDeeplink();

  approveBtn?.addEventListener('click', handleApprove);
  joinBtn?.addEventListener('click', relayJoin);

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

    await refreshModeUI(gameContract, userAddress);
    wireAdminSwitch(gameContract, signer);
    await refreshLastRound();
    window.addEventListener('focus', async () => {
      const a = (await signer.getAddress?.().catch(() => null)) || null;
      refreshModeUI(gameContract, a);
      refreshLastRound();
    });
    if (window.ethereum) {
      window.ethereum.on?.('accountsChanged', async (accs) => {
        const a = accs?.[0] || null;
        await refreshModeUI(gameContract, a);
      });
      window.ethereum.on?.('chainChanged', async () => {
        const a = (await signer.getAddress?.().catch(() => null)) || null;
        await refreshModeUI(gameContract, a);
      });
    }

    // Entry amount (fallback to 50 GCC if view not present)
    entryAmount = await gameContract.entryAmount().catch(() => ethers.parseUnits('50', 18));

    // User GCC balance check
    const balance = await gccRead.balanceOf(userAddress);
    if (balance < entryAmount) {
      setStatus('❌ Insufficient GCC balance for entry (need 50 GCC).');
      el('approveBtn').disabled = true;
      el('joinBtn').disabled = true;
      await refreshReadOnly();
      return;
    }

    await refreshAll();

    const allowance = await gccRead.allowance(userAddress, FREAKY_CONTRACT);

    const parts = await gameContract.getParticipants();
    const joinedBadge = document.getElementById('ff-joined-badge');
    const already = parts.map(a => a.toLowerCase()).includes(userAddress.toLowerCase());
    if (joinedBadge) joinedBadge.style.display = already ? 'inline-flex' : 'none';
    if (already) {
      setStatus('');
      const jb = el('joinBtn');
      if (jb) { jb.disabled = true; jb.textContent = '✅ Already Joined'; }
      el('approveBtn').disabled = true;
      attachWinnerListenerLocal();
      attachPredictedWinnerListener();
      attachRoundCompletedListener();
      await loadPredictedWinner();
      return;
    }

    const approveBtn = el('approveBtn');
    const joinBtn = el('joinBtn');
    if (allowance < entryAmount) {
      if (approveBtn) approveBtn.disabled = false;
      if (joinBtn) joinBtn.disabled = true;
    } else {
      if (approveBtn) approveBtn.disabled = true;
      if (joinBtn) joinBtn.disabled = false;
    }

    attachWinnerListenerLocal();
    attachPredictedWinnerListener();
    attachRoundCompletedListener();
    await loadPredictedWinner();
  } catch (err) {
    console.error('Connect failed:', err);
    setStatus(`❌ ${err?.message || 'Connect failed'}`);
  } finally {
    hideLoader();
  }
}

/* ---------- Approve + Join ---------- */
async function handleApprove() {
  showLoader();
  try {
    const addr = connectedAddr;
    const allowance = await gccRead.allowance(addr, FREAKY_CONTRACT);
    if (allowance < entryAmount) {
      setStatus('🔐 Approving contract...');
      const tx = await gccWrite.approve(FREAKY_CONTRACT, entryAmount);
      await tx.wait();
      setStatus('⏳ Waiting for allowance...');
      const ok = await waitForAllowance(addr);
      if (ok) {
        el('joinBtn').disabled = false;
        el('approveBtn').disabled = true;
        setStatus('Approved. You can now Join.');
      } else {
        setStatus('⚠️ Approval pending, please try again.');
      }
    } else {
      setStatus('✅ Already approved');
      el('joinBtn').disabled = false;
      el('approveBtn').disabled = true;
    }
  } catch (e) {
    console.error(e);
    setStatus(`❌ ${e?.message || 'Approval failed'}`);
  } finally {
    hideLoader();
  }
}

async function relayJoin() {
  showLoader();
  try {
    setStatus('🚀 Joining ritual...');
    const signer = await provider.getSigner();
    const addr = await signer.getAddress();
    // Call backend join endpoint which returns enter tx hash
    const resp = await fetch(`${BACKEND_URL}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: addr })
    });
    const json = await resp.json();
    if (!json?.success) {
      throw new Error(json?.error || 'Join failed');
    }

    const { enterTxHash } = json;
    showStatus([
      `You're in!`,
      `<a target="_blank" href="https://bscscan.com/tx/${enterTxHash}">View Join Tx</a>`,
      `Refunds (Standard mode) are available after the round closes.`
    ]);
    el('approveBtn').disabled = true;
    const jb = el('joinBtn');
    if (jb) { jb.disabled = true; jb.textContent = '✅ Already Joined'; }
    await refreshAll();
  } catch (e) {
    console.error(e);
    setStatus(`❌ ${e?.message || 'Join failed'}`);
  } finally {
    hideLoader();
  }
}

/* ---------- Read/UI helpers ---------- */
async function refreshAll() {
  await Promise.all([
    updateContractBalances(),
    refreshModeUI(gameContract || gameRead, connectedAddr),
    refreshLastRound()
  ]);
}
async function refreshReadOnly() {
  await Promise.all([
    updateContractBalances(),
    refreshModeUI(gameContract || gameRead, connectedAddr),
    refreshLastRound()
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
    setStatus('⚠️ Failed to load balances');
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
    refreshModeUI(gameContract, a);
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
        await refreshModeUI(gameContract, a);
        await refreshLastRound();
      }
    } catch (e) {
      // silent
    }
  })();
}

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

