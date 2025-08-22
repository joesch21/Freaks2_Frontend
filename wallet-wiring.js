// wallet-wiring.js
const FRONTEND_HOST = window.location.host; // works on Render & localhost
const METAMASK_DAPP = `https://metamask.app.link/dapp/${FRONTEND_HOST}/`;

const hasEthereum = () => typeof window.ethereum !== 'undefined';
const isAndroid   = () => /Android/i.test(navigator.userAgent);
const isInApp     = () =>
  /(FBAN|FBAV|Instagram|Line|Twitter|OkHttp|Telegram)/i.test(navigator.userAgent || '');

function wireConnect(buttonId) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try {
      // On Android with no provider or inside in-app browser, deep-link to MetaMask dApp browser.
      if (isAndroid() && (!hasEthereum() || isInApp())) {
        window.location.href = METAMASK_DAPP;
        return;
      }
      if (!hasEthereum()) {
        // Non-Android fallback: click the top deeplink if present
        const a = document.getElementById('deeplink');
        if (a) a.click();
        return;
      }
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      // Success: your existing app code (freakyfriday.js) should detect the connection and update UI.
    } catch (e) {
      console.warn('Connect cancelled/failed', e);
    }
  });
}

function exposeDeepLink(anchorId) {
  const a = document.getElementById(anchorId);
  if (!a) return;
  const shouldShow = isAndroid() && (!hasEthereum() || isInApp());
  if (shouldShow) {
    a.href = METAMASK_DAPP;
    a.classList.remove('hidden');
  } else {
    a.classList.add('hidden');
  }
}

// Wire both connect CTAs
wireConnect('connectBtn');         // top button (already working)
wireConnect('connectBtnBottom');   // lower button (needs wiring)

// Show green deeplinks when relevant
exposeDeepLink('deeplink');        // top deeplink (already in DOM)
exposeDeepLink('deeplinkBottom');  // bottom deeplink (new)
