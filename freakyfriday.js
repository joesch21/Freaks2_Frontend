// freakyfriday.js — GCC Freaky Friday (refactored)
//
// - Consistent IDs: gccBalance, bnbBalance, participantList, countdown
// - Updates both GCC & BNB balances
// - Attaches winner listener + backfill (RoundCompleted)
// - Separate approve/join flow with allowance checks
// - Chain guard for BSC mainnet (56)
// - Mobile deep link helper & robust UI handling

import { FREAKY_CONTRACT, BACKEND_URL } from './frontendinfo.js';
import { connectWallet, byId, setStatus, provider, gameContract, gccRead, gccWrite, userAddress as connectedAddr } from './frontendcore.js';
import { mountLastWinner } from './winner.js';

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
function initApp() {
  hideLoader();
  const approveBtn = el('approveBtn');
  const joinBtn = el('joinBtn');
  const claimBtn = el('claimBtn');
  const connectBtn = el('connectBtn');
  const mmLink = el('metamaskLink');
  const deeplink = el('deeplink');

  if (approveBtn) approveBtn.disabled = true;
  if (joinBtn) joinBtn.disabled = true;
  claimBtn?.setAttribute('disabled','');

  const hasProvider = typeof window.ethereum !== 'undefined';
  const ua = navigator.userAgent;
  const inApp = /Twitter|FBAN|FBAV|Instagram|Telegram|GoogleWebView/i.test(ua);

  if (hasProvider && connectBtn) {
    connectBtn.style.display = '';
    connectBtn.addEventListener('click', connectMetaMask);
  } else if (connectBtn) {
    connectBtn.style.display = 'none';
  }

  if ((!hasProvider || inApp) && mmLink) {
    mmLink.classList.remove('hidden');
    if (deeplink) {
      const host = window.location.host;
      deeplink.href = `https://metamask.app.link/dapp/${host}`;
    }
  }

  approveBtn?.addEventListener('click', handleApprove);
  joinBtn?.addEventListener('click', relayJoin);
  claimBtn?.addEventListener('click', claimRefund);
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
async function connectMetaMask() {
  if (!window.ethereum) {
    alert('MetaMask not detected. Please install it.');
    return;
  }

  showLoader();
  try {
    await ensureBscMainnet();

    const { userAddress } = await connectWallet();
    setStatus(`🔗 Connected: ${userAddress}`);
    text('walletAddress', userAddress);

    await mountLastWinner(provider);

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
    console.error(err);
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
    updateModeDisplay()
  ]);
}
async function refreshReadOnly() {
  await Promise.all([
    updateContractBalances(),
    updateModeDisplay()
  ]);
}

/* ---------- Mode display ---------- */
async function updateModeDisplay() {
  try {
    if (!gameContract) return;
    // Prefer getRoundMode() if available; fallback to public roundMode() variable
    const mode = gameContract.getRoundMode ? await gameContract.getRoundMode() : await gameContract.roundMode();
    const modeEl = document.getElementById('modeDisplay');
    if (!modeEl) return;
    const m = Number(mode);
    modeEl.innerText = m === 0 ? 'Standard Ritual' : m === 1 ? 'Jackpot' : String(m);
  } catch (e) {
    console.warn('Mode load failed', e);
    setStatus('⚠️ Failed to load mode');
  }
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
    // Read token balance from the contract via view function instead of reading
    // directly from the token.  This accounts for escrowed/refundable amounts.
    const gccBal = await gameContract.getContractTokenBalance();
    setTextAny(['gccBalance'], `${ethers.formatUnits(gccBal, 18)} GCC`);

    const bnbBal = await gameContract.checkBNBBalance();
    setTextAny(['bnbBalance'], `${ethers.formatUnits(bnbBal, 18)} BNB`);
  } catch (e) {
    console.warn('Balance load failed', e);
    setStatus('⚠️ Failed to load balances');
  }
}

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

  const update = (winner, round, prizePaid, refundPerPlayerFinal) => {
    text('lastWinner', winner);
    text('prize', `${ethers.formatUnits(prizePaid, 18)} GCC`);
    text('refund', `${ethers.formatUnits(refundPerPlayerFinal, 18)} GCC per player`);
    window.currentClosedRound = Number(round);
    el('claimBtn')?.removeAttribute('disabled');
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
        update(...events[events.length - 1].args);
      }
    } catch (e) {
      // silent
    }
  })();
}

async function claimRefund() {
  showLoader();
  try {
    const signer = await provider.getSigner();
    const gameW = gameContract.connect(signer);
    const tx = await gameW.claimRefund(window.currentClosedRound);
    const r = await tx.wait();
    showStatus([`Refund claimed.`, `<a target="_blank" href="https://bscscan.com/tx/${r?.hash || tx.hash}">View Tx</a>`]);
  } catch (e) {
    console.error(e);
    showStatus(`❌ ${e?.message || 'Refund claim failed'}`);
  } finally {
    hideLoader();
  }
}
