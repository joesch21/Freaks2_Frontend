import { ethers } from 'ethers';
import abi from './abi/freakyFridayGameAbi.js';
import { FREAKY_CONTRACT } from './frontendinfo.js';

export async function mountLastWinner(provider) {
  try {
    const contract = new ethers.Contract(FREAKY_CONTRACT, abi, provider);
    const filter = contract.filters.RoundCompleted();
    const latest = await provider.getBlockNumber();
    const from = Math.max(1, latest - 100000);
    const logs = await contract.queryFilter(filter, from, latest);
    const last = logs.at(-1);
    if (last) {
      const { winner, round } = last.args;
      renderLastWinner(winner, round);
    }
    contract.on(filter, (winner, round) => renderLastWinner(winner, round));
  } catch (e) {
    hideLastWinner();
    console.error('last winner load failed', e);
  }
}

function renderLastWinner(addr, round) {
  const row = document.getElementById('lastWinnerRow');
  if (!row) return;
  document.getElementById('lastWinnerAddr').textContent = addr;
  document.getElementById('lastWinnerRound').textContent = Number(round);
  row.style.display = 'block';
}

function hideLastWinner() {
  const row = document.getElementById('lastWinnerRow');
  if (row) row.style.display = 'none';
}
