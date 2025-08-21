// frontendcore.js (refactored)

// ---- Imports ----
import { FREAKY_CONTRACT, GCC_TOKEN, FREAKY_RELAYER } from './frontendinfo.js';
import freakyFridayGameAbi from './freakyFridayGameAbi.js';
import erc20Abi from './erc20Abi.js';

// ---- DOM helpers ----
export const byId = (id) => document.getElementById(id);

export function setStatus(msg) {
  const statusEl = byId('status');
  if (statusEl) statusEl.innerText = msg ?? '';
}

// ---- Runtime state (populated on connect) ----
// Read-only provider and contracts (available even before wallet connection)
export const rpcProvider = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org');
export const gameRead = new ethers.Contract(FREAKY_CONTRACT, freakyFridayGameAbi, rpcProvider);
export const gccRead = new ethers.Contract(GCC_TOKEN, erc20Abi, rpcProvider);

// Runtime state populated after wallet connection
export let provider;
export let signer;
export let userAddress;
export let gameContract; // write-enabled contract
export let gccWrite;

// ---- Small utils ----
const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
const bscScanTx = (txHash) => `https://bscscan.com/tx/${txHash}`; // swap to testnet explorer if needed

function updateWinnerBar({ winner, round, tx }) {
  const bar = byId('winnerBar');
  const addr = byId('winnerAddr');
  const link = byId('winnerTxLink');
  if (!bar || !addr || !link) return;

  addr.textContent = `${shortAddr(winner)} (Round ${Number(round)})`;
  if (tx) {
    link.href = bscScanTx(tx);
    link.style.display = '';
  } else {
    link.style.display = 'none';
  }
  bar.style.display = 'block';
}

/**
 * Attach real-time and backfilled winner announcements.
 * Requires gameContract to be initialized.
 */
export async function attachWinnerListener() {
  if (!gameContract) return;

  // Live updates via event
  try {
    gameContract.on('RoundCompleted', (winner, round, ev) => {
      const tx = ev?.log?.transactionHash ?? null;
      updateWinnerBar({ winner, round, tx });
    });
  } catch (e) {
    console.warn('Failed to attach RoundCompleted listener:', e);
  }

  // Backfill most recent winner on load
  try {
    const filter = gameContract.filters.RoundCompleted();
    const recent = await gameContract.queryFilter(filter, -5000); // search recent blocks
    if (recent.length) {
      const last = recent[recent.length - 1];
      const [winner, round] = last.args;
      updateWinnerBar({ winner, round, tx: last?.log?.transactionHash ?? null });
    }
  } catch (e) {
    console.warn('Winner backfill failed:', e);
  }
}

/**
 * Connect wallet, initialize contracts, and start listeners.
 * @returns {{provider: ethers.BrowserProvider, signer: ethers.Signer, userAddress: string, gameContract: ethers.Contract, gccWrite: ethers.Contract, gccRead: ethers.Contract}}
 */
export async function connectWallet() {
  if (!window.ethereum) {
    throw new Error('No Ethereum provider found. Please install MetaMask or another wallet.');
  }

  // Request account access
  await window.ethereum.request({ method: 'eth_requestAccounts' });

  // Initialize ethers provider/signer
  provider = new ethers.BrowserProvider(window.ethereum);
  signer = await provider.getSigner();
  userAddress = await signer.getAddress();

  // Initialize contracts with signer
  gameContract = new ethers.Contract(FREAKY_CONTRACT, freakyFridayGameAbi, signer);
  gccWrite = new ethers.Contract(GCC_TOKEN, erc20Abi, signer);

  // Start live + backfill winner announcements
  try {
    await attachWinnerListener();
  } catch (e) {
    console.warn('attachWinnerListener error:', e);
  }

  return { provider, signer, userAddress, gameContract, gccWrite, gccRead };
}

// Keep relayer constant available to other modules
export { FREAKY_RELAYER };
