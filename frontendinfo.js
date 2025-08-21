// frontendinfo.js
//
// This module defines constants for the Freaks2 front‑end.  Update these
// values to point at your deployed contract, the GCC token and your
// backend API.  These values are consumed by the core application code.

// Address of the deployed FreakyFridayAuto contract (Freaks2).  Replace
// this placeholder with your actual contract address after deployment.
export const FREAKY_CONTRACT = '<YOUR_FREAKY_CONTRACT_ADDRESS>';

// Address of the GCC token contract on Binance Smart Chain.  Replace this
// placeholder with the official GCC token address on mainnet.
export const GCC_TOKEN = '<YOUR_GCC_TOKEN_ADDRESS>';

// Address of your relayer wallet.  This constant is retained for
// completeness, but note that approvals now target the game contract
// directly.  You may still display the relayer address to users for
// transparency or auditing purposes.
export const FREAKY_RELAYER = '<YOUR_RELAYER_ADDRESS>';

// Base URL of the backend API.  The frontend will call relative paths on
// this host (e.g. `${BACKEND_URL}/relay-entry`).  Update this to match
// your deployed backend service (for local testing, use http://localhost:3000).
export const BACKEND_URL = 'http://localhost:3000';

// No helper functions are defined here.  See freakyfriday.js for UI update
// logic.