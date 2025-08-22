// unified-join.js
import { ethers } from "ethers";
import gameAbi from "./abi/freakyFridayGameAbi.js";
import { FREAKY_CONTRACT, GCC_TOKEN, BACKEND_URL } from "./frontendinfo.js";

const erc20Abi = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)"
];

const BSC = {
  chainId: "0x38",
  chainName: "Binance Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: ["https://bsc-dataseed.binance.org/"],
  blockExplorerUrls: ["https://bscscan.com/"],
};

function toast(msg, type = "info") {
  const el = document.getElementById("status");
  if (!el) return alert(msg);
  el.innerHTML = `<div class="toast ${type}">${msg}</div>`;
}

async function ensureBSC(windowEth) {
  const c = await windowEth.request({ method: "eth_chainId" });
  if (c !== BSC.chainId) {
    try {
      await windowEth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BSC.chainId }] });
    } catch (e) {
      if (e?.code === 4902) {
        await windowEth.request({ method: "wallet_addEthereumChain", params: [BSC] });
      } else {
        throw e;
      }
    }
  }
}

export async function unifiedJoin() {
  try {
    if (!window.ethereum) throw new Error("No wallet found");

    // 1) Connect & ensure BSC
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    await ensureBSC(window.ethereum);

    const signer = await provider.getSigner();
    const user = await signer.getAddress();
    const game = new ethers.Contract(FREAKY_CONTRACT, gameAbi, provider);

    // Round gating preflight
    const [roundStartBN, durationBN] = await Promise.all([game.roundStart(), game.duration()]);
    const roundStart = Number(roundStartBN);
    const duration   = Number(durationBN);
    const now = Math.floor(Date.now() / 1000);

    if (roundStart === 0 && window.FF_GATE_JOIN_UNTIL_ACTIVE) {
      throw new Error("Round not active yet.");
    }
    if (roundStart > 0 && now >= (roundStart + duration)) {
      throw new Error("Round window ended; waiting for close.");
    }

    // 2) Read entry from chain (no magic numbers)
    const entry = await game.entryAmount();

    // 3) Auto-approve if needed (MAX to avoid repeated prompts)
    const erc20 = new ethers.Contract(GCC_TOKEN, erc20Abi, signer);
    const currentAllowance = await erc20.allowance(user, FREAKY_CONTRACT);
    if (currentAllowance < entry) {
      toast("Approving GCC for the game…", "info");
      const approveTx = await erc20.approve(FREAKY_CONTRACT, ethers.MaxUint256);
      await approveTx.wait();
    }

    // 4) Relay the join via backend
    toast("Joining the ritual…", "info");
    const resp = await fetch(`${BACKEND_URL}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user })
    });
    const json = await resp.json();
    if (!resp.ok || !json?.success) throw new Error(json?.detail || json?.error || "Join failed");

    const link = `https://bscscan.com/tx/${json.enterTxHash || json.txHash}`;
    toast(
      `🎉 You’ve joined! <a href="${link}" target="_blank" rel="noopener">View tx</a><br/>Refunds are paid after the round closes. Good luck!`,
      "success"
    );
  } catch (err) {
    const msg = err?.shortMessage || err?.message || String(err);
    toast(`❌ ${msg}`, "error");
  }
}
