// freakyFridayGameAbi.js
//
// This file exports a complete ABI for the FreakyFridayAuto (Freaks2) contract.
// It includes both function and event definitions so that ethers.js can decode
// events such as `RoundCompleted` and `Joined` for real‑time UI updates.
//
// NOTE: If you change the Solidity contract, regenerate this ABI from your
// source using solc or another build tool.  This version has been
// hand‑crafted based on the deployed contract and includes the following
// events:
//   - Joined(address indexed user, uint256 round)
//   - RoundCompleted(address indexed winner, uint256 round)
//   - RoundModeChanged(uint8 newMode)
//   - Received(address sender, uint256 amount)
//   - RefundClaimed(address indexed user, uint256 indexed round, uint256 amount)
//   - CloseTipPaid(address indexed caller, uint256 amount)

const freakyFridayGameAbi = [
  // Functions
  {
    "inputs": [],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "enter",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "address", "name": "user", "type": "address" } ],
    "name": "relayedEnter",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "address", "name": "_relayer", "type": "address" } ],
    "name": "setRelayer",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "uint256", "name": "newLimit", "type": "uint256" } ],
    "name": "setMaxPlayers",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "uint256", "name": "newTip", "type": "uint256" } ],
    "name": "setCloseTip",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "uint256", "name": "amount", "type": "uint256" } ],
    "name": "fundBonus",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "address payable", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" } ],
    "name": "withdrawBNB",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" } ],
    "name": "withdrawLeftovers",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "uint8", "name": "newMode", "type": "uint8" } ],
    "name": "setRoundMode",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getRoundMode",
    "outputs": [ { "internalType": "uint8", "name": "", "type": "uint8" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "uint256", "name": "round", "type": "uint256" } ],
    "name": "claimRefund",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "uint256", "name": "round", "type": "uint256" }, { "internalType": "address[]", "name": "users", "type": "address[]" }, { "internalType": "uint256", "name": "maxCount", "type": "uint256" } ],
    "name": "batchClaimRefunds",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "checkTimeExpired",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "isRoundActive",
    "outputs": [ { "internalType": "bool", "name": "", "type": "bool" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "roundStart",
    "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "duration",
    "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "entryAmount",
    "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "currentRound",
    "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "roundMode",
    "outputs": [ { "internalType": "uint8", "name": "", "type": "uint8" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "maxPlayers",
    "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getParticipants",
    "outputs": [ { "internalType": "address[]", "name": "", "type": "address[]" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getContractTokenBalance",
    "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "checkRewardBalance",
    "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "checkBNBBalance",
    "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "uint256", "name": "round", "type": "uint256" } ],
    "name": "roundModeAtClose",
    "outputs": [ { "internalType": "uint8", "name": "", "type": "uint8" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "uint256", "name": "round", "type": "uint256" } ],
    "name": "playersInRound",
    "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "uint256", "name": "round", "type": "uint256" } ],
    "name": "winnerOfRound",
    "outputs": [ { "internalType": "address", "name": "", "type": "address" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "uint256", "name": "round", "type": "uint256" } ],
    "name": "refundPerPlayer",
    "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "uint256", "name": "round", "type": "uint256" } ],
    "name": "roundResolved",
    "outputs": [ { "internalType": "bool", "name": "", "type": "bool" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "uint256", "name": "round", "type": "uint256" }, { "internalType": "address", "name": "user", "type": "address" } ],
    "name": "refundClaimed",
    "outputs": [ { "internalType": "bool", "name": "", "type": "bool" } ],
    "stateMutability": "view",
    "type": "function"
  },
  // Events
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true,  "internalType": "address", "name": "user",  "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "round", "type": "uint256" }
    ],
    "name": "Joined",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true,  "internalType": "address", "name": "winner", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "round",  "type": "uint256" }
    ],
    "name": "RoundCompleted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": false, "internalType": "uint8", "name": "newMode", "type": "uint8" }
    ],
    "name": "RoundModeChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": false, "internalType": "address", "name": "sender", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "Received",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true,  "internalType": "address", "name": "user",  "type": "address" },
      { "indexed": true,  "internalType": "uint256", "name": "round",  "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "RefundClaimed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true,  "internalType": "address", "name": "caller", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "CloseTipPaid",
    "type": "event"
  }
];

export default freakyFridayGameAbi;