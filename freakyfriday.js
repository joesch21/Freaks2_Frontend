// freakyfriday.js — GCC Freaky Friday (refactored)
//
// - Consistent IDs: gccBalance, bnbBalance, participantList, countdown
// - Updates both GCC & BNB balances
// - Attaches winner listener + backfill (RoundCompleted)
// - One-click approve+join via relayer
// - Chain guard for BSC mainnet (56)
// - Mobile deep link helper & robust UI handling

import { FREAKY_CONTRACT, BACKEND_URL } from './frontendinfo.js';
import { connectWallet, byId, setStatus, provider, gameContract, gccRead, gccWrite, userAddress as connectedAddr } from './frontendcore.js';
import { maybeShowTimer } from './frontendtimer.js';

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
    // Build a filter for the RoundCompleted event (winner, round).
    const filter = gameContract.filters.RoundCompleted(null, null);
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
    gameContract.on('RoundCompleted', (winner /* address */, round /* BigInt */) => {
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

/* ---------- Loader ---------- */
function showLoader(){ el('loader')?.classList?.remove('hidden'); }
function hideLoader(){ el('loader')?.classList?.add('hidden'); }

/* ---------- Init ---------- */
function initApp() {
  hideLoader();
  el('approveBtn').disabled = true;
  el('joinBtn').disabled = true;

  el('connectBtn').addEventListener('click', connectMetaMask);
  el('approveBtn').addEventListener('click', handleApprove);
  el('joinBtn').addEventListener('click', relayJoin);

  // Mobile deep link hint
  const mmLink = el('metamaskLink');
  if (/Mobi|Android|iPhone/i.test(navigator.userAgent) && mmLink) {
    mmLink.classList.remove('hidden');
  }
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

    // Entry amount (fallback to 50 GCC if view not present)
    entryAmount = await gameContract.entryAmount().catch(() => ethers.parseUnits('50', 18));

    // User GCC balance check
    const balance = await gccRead.balanceOf(userAddress);
    if (balance < entryAmount) {
      setStatus('❌ Insufficient GCC balance for entry (need 50 GCC).');
      hide('approveBtn'); hide('joinBtn');
      await refreshReadOnly(); // still show stats
      return;
    }

    await refreshAll(); // participants, balances, timer

    // Already joined?
    const parts = await gameContract.getParticipants();
    if (parts.map(a => a.toLowerCase()).includes(userAddress.toLowerCase())) {
      setStatus('✅ Already joined this round');
      hide('approveBtn'); hide('joinBtn');
      // Still attach live winner listeners for UI updates.
      attachWinnerListenerLocal();
      attachPredictedWinnerListener();
      await loadPredictedWinner();
      return;
    }

    el('approveBtn').disabled = false;

    // Winner banner live + backfill
    attachWinnerListenerLocal();
    // Predicted winner backfill + live listener
    attachPredictedWinnerListener();
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
    await checkAndApprove();
    setStatus('🚀 Approval done, joining...');
    await relayJoin();
    hide('joinBtn'); hide('approveBtn');
  } catch (e) {
    console.error(e);
    setStatus(`❌ ${e?.message || 'Approval failed'}`);
  } finally {
    hideLoader();
  }
}

async function checkAndApprove() {
  const addr = connectedAddr;
  const allowance = await gccRead.allowance(addr, FREAKY_CONTRACT);

  if (allowance < entryAmount) {
    setStatus('🔐 Approving contract...');
    // Users must approve the game contract directly.  The relayer no longer holds tokens.
    const tx = await gccWrite.approve(FREAKY_CONTRACT, entryAmount);
    await tx.wait();
    setStatus('✅ Approved');
  } else {
    setStatus('✅ Already approved');
  }
  el('joinBtn').disabled = false;
}

async function relayJoin() {
  showLoader();
  try {
    setStatus('🚀 Joining ritual...');
    const signer = await provider.getSigner();
    const addr = await signer.getAddress();
    // Call our backend relayer to register the user.  The backend will call
    // relayedEnter(user) using its own signer.
    const res = await fetch(`${BACKEND_URL}/relay-entry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: addr })
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setStatus(`✅ Joined! tx: ${data.txHash || 'pending'}`);
      await refreshAll();
    } else {
      setStatus(`❌ Join failed: ${data.detail || data.error || res.statusText}`);
    }
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
    showParticipants(),
    updateContractBalances(),
    maybeShowTimer(gameContract),
    updateModeDisplay(),
    showLastWinner()
  ]);
}
async function refreshReadOnly() {
  await Promise.all([
    updateContractBalances(),
    maybeShowTimer(gameContract),
    showParticipants(),
    updateModeDisplay(),
    showLastWinner()
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
  }
}

async function showParticipants() {
  try {
    const players = await gameContract.getParticipants();
    const list = el('participantList');
    if (!list) return;
    list.innerHTML = '';
    players.forEach((a, i) => {
      const li = document.createElement('li');
      li.innerText = `#${i + 1}: ${a}`;
      list.appendChild(li);
    });
  } catch (e) {
    console.warn('Participants load failed', e);
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
    setTextAny(['gccBalance','poolBalance'], `${ethers.formatUnits(gccBal, 18)} GCC`);

    const bnbBal = await gameContract.checkBNBBalance();
    setTextAny(['bnbBalance'], `${ethers.formatUnits(bnbBal, 18)} BNB`);
  } catch (e) {
    console.warn('Balance load failed', e);
  }
}

/* ---------- Last winner display ---------- */
async function showLastWinner() {
  try {
    if (!gameContract) return;
    // Determine the most recent resolved round.  If the current round is active, use currentRound - 1; otherwise currentRound.
    const currentRound = await gameContract.currentRound();
    const isActive = await gameContract.isRoundActive();
    let lastRound = Number(currentRound);
    if (isActive) lastRound = lastRound - 1;
    const container = document.getElementById('lastWinnerContainer');
    if (!container) return;
    if (!lastRound || lastRound <= 0) {
      container.style.display = 'none';
      return;
    }
    const winner = await gameContract.winnerOfRound(lastRound);
    // Hide if no winner recorded (address zero)
    if (!winner || winner === '0x0000000000000000000000000000000000000000') {
      container.style.display = 'none';
      return;
    }
    container.style.display = '';
    const addrEl = document.getElementById('lastWinnerAddr');
    const roundEl = document.getElementById('lastWinnerRound');
    if (addrEl) addrEl.innerText = short(winner);
    if (roundEl) roundEl.innerText = String(lastRound);
  } catch (e) {
    console.warn('Last winner load failed', e);
  }
}


/* ---------- Winner banner (local listener + backfill) ---------- */
function attachWinnerListenerLocal() {
  if (!gameContract) return;

  // Live event
  try {
    gameContract.on('RoundCompleted', (winner, round, ev) => {
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
