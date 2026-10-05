import { createClient } from 'genlayer-js';
import { studionet, testnetBradbury, testnetAsimov } from 'genlayer-js/chains';
import './style.css';

const networks = {
  studionet: { label: 'Studionet', chain: studionet, explorer: 'https://explorer-studio.genlayer.com' },
  testnetBradbury: { label: 'Bradbury testnet', chain: testnetBradbury, explorer: 'https://explorer-bradbury.genlayer.com' },
  testnetAsimov: { label: 'Asimov testnet', chain: testnetAsimov, explorer: 'https://explorer-asimov.genlayer.com' },
};
const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const txHashPattern = /^0x[a-fA-F0-9]{64}$/;
const maxUint = (1n << 256n) - 1n;
const el = (selector) => document.querySelector(selector);
const networkSelect = el('#network');
const addressInput = el('#contract-address');
const activity = el('#activity');

let networkKey = 'studionet';
let account = '';
let client;
let provider;
let preparedReview;
let pendingTx;

try {
  const savedPending = JSON.parse(localStorage.getItem('issuegauge.pending') || 'null');
  if (savedPending && txHashPattern.test(savedPending.hash)
    && networks[savedPending.networkKey] && addressPattern.test(savedPending.address)) {
    pendingTx = savedPending;
  }
} catch {
  pendingTx = undefined;
}

const params = new URLSearchParams(window.location.search);
if (networks[params.get('network')]) {
  networkKey = params.get('network');
  networkSelect.value = networkKey;
}
if (params.has('contract')) addressInput.value = params.get('contract');
const storedAddress = localStorage.getItem('issuegauge.contract');
const storedNetwork = localStorage.getItem('issuegauge.network');
if (!params.has('contract') && storedAddress) addressInput.value = storedAddress;
if (!params.has('network') && networks[storedNetwork]) {
  networkKey = storedNetwork;
  networkSelect.value = networkKey;
}
if (params.has('review')) el('#review-id').value = params.get('review');

function setActivity(message, isError = false) {
  activity.textContent = message;
  activity.classList.toggle('error', isError);
}

function getAddress() {
  const value = addressInput.value.trim();
  return addressPattern.test(value) ? value : '';
}

function readClient() {
  return createClient({ chain: networks[networkKey].chain });
}

function updateUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set('network', networkKey);
  if (getAddress()) url.searchParams.set('contract', getAddress());
  if (el('#review-id').value.trim()) url.searchParams.set('review', el('#review-id').value.trim());
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

function canonicalIssueUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com'
      || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) return '';
    const match = parsed.pathname.match(/^\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/issues\/([1-9][0-9]*)\/?$/);
    if (!match || match[1] === '.' || match[1] === '..' || match[2] === '.' || match[2] === '..') return '';
    if (match[3].length > 78) return '';
    return `https://github.com/${match[1]}/${match[2]}/issues/${match[3]}`;
  } catch {
    return '';
  }
}

function updatePrepareState() {
  el('#url-count').textContent = `${el('#issue-url').value.length} / 2048`;
  const issueUrl = canonicalIssueUrl(el('#issue-url').value.trim());
  if (preparedReview && (preparedReview.issueUrl !== issueUrl || !el('#public-consent').checked)) {
    preparedReview = undefined;
    el('#fee-panel').hidden = true;
  }
  el('#estimate-button').disabled = !(account && getAddress() && issueUrl
    && el('#public-consent').checked && !pendingForCurrentContract());
}

function pendingForCurrentContract() {
  return Boolean(pendingTx && pendingTx.networkKey === networkKey
    && pendingTx.address.toLowerCase() === getAddress().toLowerCase());
}

function showPendingNotice() {
  if (!pendingForCurrentContract()) return;
  setActivity(`A previous transaction is still being tracked (${pendingTx.hash}). Do not submit the same review again.`);
}

async function trackPendingTransaction() {
  if (!pendingForCurrentContract()) return;
  const checked = pendingTx;
  setActivity(`Checking ${checked.hash} for finalization…`);
  try {
    const receipt = await readClient().waitForTransactionReceipt({ hash: checked.hash, status: 'ACCEPTED' });
    if (pendingTx?.hash !== checked.hash) return;
    localStorage.removeItem('issuegauge.pending');
    pendingTx = undefined;
    if (receipt.txExecutionResultName === 'FINISHED_WITH_RETURN') {
      setActivity('The earlier transaction finalized. Loading its stored review…');
      const count = BigInt(String(await readClient().readContract({ address: checked.address, functionName: 'get_review_count', args: [] })));
      if (count > 0n) await loadReview(count - 1n);
    } else {
      setActivity(`The earlier transaction ended without a successful review (${receipt.statusName} / ${receipt.txExecutionResultName}). Check the explorer before retrying.`, true);
    }
  } catch {
    setActivity(`The transaction is not final yet. It remains locked against duplicate submission: ${checked.hash}`, true);
  } finally {
    updatePrepareState();
  }
}

function walletProvider() {
  return window.okxwallet || window.phantom?.ethereum || window.ethereum || null;
}

async function connectProviderToNetwork(selectedProvider, chain) {
  const chainId = `0x${chain.id.toString(16)}`;
  const currentChainId = await selectedProvider.request({ method: 'eth_chainId' });
  if (String(currentChainId).toLowerCase() === chainId.toLowerCase()) return;
  try {
    await selectedProvider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (error) {
    if (Number(error?.code) !== 4902) throw error;
    const chainParams = {
      chainId,
      chainName: chain.name,
      rpcUrls: chain.rpcUrls.default.http,
      nativeCurrency: chain.nativeCurrency,
      ...(chain.blockExplorers?.default.url ? { blockExplorerUrls: [chain.blockExplorers.default.url] } : {}),
    };
    await selectedProvider.request({ method: 'wallet_addEthereumChain', params: [chainParams] });
    await selectedProvider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  }
  const confirmedChainId = await selectedProvider.request({ method: 'eth_chainId' });
  if (String(confirmedChainId).toLowerCase() !== chainId.toLowerCase()) {
    throw new Error(`The wallet stayed on chain ${confirmedChainId}; switch it to ${chain.name} and reconnect.`);
  }
}

async function connectWallet() {
  provider = walletProvider();
  if (!provider?.request) {
    setActivity('No compatible EVM wallet was found. Enable OKX, MetaMask, or Phantom EVM for the selected GenLayer test network, then retry.', true);
    return;
  }
  el('#connect-wallet').disabled = true;
  setActivity(`Requesting wallet access for ${networks[networkKey].label}…`);
  try {
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    if (!Array.isArray(accounts) || !accounts[0]) throw new Error('The wallet did not return an account.');
    account = accounts[0];
    await connectProviderToNetwork(provider, networks[networkKey].chain);
    client = createClient({ chain: networks[networkKey].chain, account, provider });
    el('#wallet-status').textContent = `${account.slice(0, 6)}…${account.slice(-4)} · connected`;
    el('#network-status').textContent = networks[networkKey].label;
    el('#connect-wallet').innerHTML = 'Wallet connected <span>✓</span>';
    setActivity(`Wallet connected to ${networks[networkKey].label}. No issue has been submitted.`);
  } catch (error) {
    account = '';
    client = undefined;
    el('#wallet-status').textContent = 'Wallet not connected';
    el('#connect-wallet').innerHTML = 'Connect wallet <span>↗</span>';
    setActivity(error instanceof Error ? error.message : 'The wallet connection did not complete.', true);
  } finally {
    el('#connect-wallet').disabled = false;
    updatePrepareState();
  }
}

function parseId(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) throw new Error('Enter a nonnegative whole-number review ID.');
  const id = BigInt(text);
  if (id > maxUint) throw new Error('Review ID must fit the contract uint256 range.');
  return id;
}

function parseRecord(raw) {
  if (typeof raw === 'string') {
    if (!raw.trim()) return null;
    try { return JSON.parse(raw); } catch { throw new Error('The contract returned a malformed review record.'); }
  }
  return raw;
}

function flagLabel(value) {
  return value === true ? '✓' : '×';
}

function showReview(record, id) {
  el('#result-empty').hidden = true;
  el('#result-content').hidden = false;
  el('#result-card').classList.remove('empty-result');
  const status = String(record.status || 'UNCLEAR').toUpperCase();
  if (!['READY', 'NEEDS_DETAIL', 'UNCLEAR'].includes(status)) throw new Error('The contract returned an unknown review status.');
  el('#review-status').textContent = status.replace('_', ' ');
  el('#review-status').className = `status-pill ${status.toLowerCase().replace('_', '-')}`;
  el('#review-number').textContent = `REVIEW ${id.toString()} · FINALIZED`;
  const kind = String(record.issue_kind || 'UNCLEAR').toUpperCase();
  if (!['BUG', 'FEATURE', 'QUESTION', 'OTHER', 'UNCLEAR'].includes(kind)) throw new Error('The contract returned an unknown issue type.');
  el('#review-kind').textContent = `${kind} · ${record.readiness_score ?? 0}/80 checklist points`;
  const parsedUrl = canonicalIssueUrl(String(record.issue_url || ''));
  const issueLink = el('#review-url');
  if (parsedUrl) {
    issueLink.href = parsedUrl;
    issueLink.textContent = parsedUrl;
    issueLink.hidden = false;
  } else {
    issueLink.removeAttribute('href');
    issueLink.textContent = 'Issue URL unavailable.';
  }
  for (const field of ['problem_clear', 'steps_or_acceptance', 'context_present', 'supporting_evidence']) {
    const marker = document.querySelector(`[data-flag="${field}"]`);
    marker.textContent = flagLabel(record[field]);
    marker.classList.toggle('pass', record[field] === true);
    marker.classList.toggle('fail', record[field] !== true);
  }
  el('#review-note').textContent = typeof record.note === 'string' ? record.note : 'No leader note was stored.';
  el('#review-score').textContent = `${Number.isFinite(Number(record.readiness_score)) ? Number(record.readiness_score) : 0} / 80`;
  const share = new URL(window.location.href);
  share.searchParams.set('network', networkKey);
  share.searchParams.set('contract', getAddress());
  share.searchParams.set('review', id.toString());
  const shareLink = el('#share-link');
  shareLink.href = share.toString();
  shareLink.onclick = async (event) => {
    event.preventDefault();
    try {
      await navigator.clipboard.writeText(share.toString());
      setActivity('Review link copied. Anyone with the link can read this public result.');
    } catch {
      window.prompt('Copy this public review link:', share.toString());
    }
  };
}

async function loadReview(id) {
  const address = getAddress();
  if (!address) throw new Error('Enter a valid deployed contract address first.');
  const read = readClient();
  const count = BigInt(String(await read.readContract({ address, functionName: 'get_review_count', args: [] })));
  el('#review-count').textContent = count.toString();
  el('#latest-button').disabled = count === 0n;
  if (id >= count) throw new Error(`No finalized review with ID ${id.toString()} exists yet.`);
  const record = parseRecord(await read.readContract({ address, functionName: 'get_review', args: [id] }));
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('No stored review was returned for this ID.');
  showReview(record, id);
  el('#review-id').value = id.toString();
  updateUrl();
  setActivity(`Review ${id.toString()} loaded from ${networks[networkKey].label}. Read only; no transaction was sent.`);
}

async function loadCount() {
  const address = getAddress();
  if (!address) {
    el('#review-count').textContent = '—';
    el('#latest-button').disabled = true;
    return;
  }
  try {
    const count = BigInt(String(await readClient().readContract({ address, functionName: 'get_review_count', args: [] })));
    el('#review-count').textContent = count.toString();
    el('#latest-button').disabled = count === 0n;
    if (params.has('review')) await loadReview(parseId(params.get('review')));
    else if (count > 0n) {
      el('#result-empty').hidden = false;
      el('#result-content').hidden = true;
      el('#review-label').textContent = `${count.toString()} REVIEWS STORED`;
      setActivity('Contract found. Choose a review ID or load the latest result.');
    } else setActivity('Contract found. No reviews have been stored yet.');
  } catch (error) {
    el('#review-count').textContent = '—';
    setActivity(error instanceof Error ? error.message : 'Could not read this contract.', true);
  }
}

async function prepareReview(event) {
  event.preventDefault();
  const address = getAddress();
  const issueUrl = canonicalIssueUrl(el('#issue-url').value.trim());
  if (!address) return setActivity('Paste a valid deployed contract address first.', true);
  if (!issueUrl) return setActivity('Use one public URL in the form https://github.com/owner/repository/issues/123.', true);
  if (!el('#public-consent').checked) return setActivity('Confirm that the issue URL and result will be public on-chain data.', true);
  if (!client || !account) return setActivity('Connect your wallet before requesting a fee estimate.', true);
  if (pendingForCurrentContract()) return showPendingNotice();

  const write = { address, functionName: 'review_issue', args: [issueUrl] };
  el('#estimate-button').disabled = true;
  el('#fee-panel').hidden = true;
  setActivity('Running a preflight simulation. No transaction is being submitted…');
  try {
    await client.simulateWriteContract(write);
    preparedReview = { write, networkKey, address, issueUrl };
    el('#fee-value').textContent = 'Passed';
    el('#fee-panel').hidden = false;
    setActivity('Preflight simulation passed. Check the test network and any fee shown in your wallet before submitting.');
  } catch (error) {
    preparedReview = undefined;
    setActivity(error instanceof Error ? error.message : 'Could not estimate this issue review fee.', true);
  } finally {
    updatePrepareState();
  }
}

async function submitReview() {
  if (!preparedReview || !client || !account) return;
  if (pendingForCurrentContract()) return showPendingNotice();
  const current = preparedReview;
  if (current.networkKey !== networkKey || current.address !== getAddress()
    || current.issueUrl !== canonicalIssueUrl(el('#issue-url').value.trim())) {
    preparedReview = undefined;
    el('#fee-panel').hidden = true;
    return setActivity('The network, contract, or URL changed. Prepare a fresh estimate before submitting.', true);
  }
  if (!window.confirm(`Submit this issue review on ${networks[networkKey].label}?\n\nThe GitHub URL and checklist result will be public on-chain data. Check any fee shown in your wallet before approving.`)) return;

  el('#submit-review').disabled = true;
  el('#estimate-button').disabled = true;
  setActivity('Waiting for wallet approval. Verify the test network and fee in your wallet…');
  let txHash;
  try {
    txHash = await client.writeContract(current.write);
  } catch (error) {
    el('#submit-review').disabled = false;
    updatePrepareState();
    setActivity(error instanceof Error ? error.message : 'The wallet did not submit this transaction.', true);
    return;
  }

  const txUrl = `${networks[networkKey].explorer}/tx/${txHash}`;
  pendingTx = { hash: txHash, networkKey, address: current.address };
  localStorage.setItem('issuegauge.pending', JSON.stringify(pendingTx));
  updatePrepareState();
  setActivity(`Transaction submitted: ${txHash}. Waiting for finalization. Do not submit the same review again.`);
  try {
    const receipt = await client.waitForTransactionReceipt({ hash: txHash, status: 'ACCEPTED' });
    if (receipt.txExecutionResultName !== 'FINISHED_WITH_RETURN') {
      throw new Error(`Transaction did not succeed: ${receipt.statusName} / ${receipt.txExecutionResultName}. Inspect ${txUrl}`);
    }
    localStorage.removeItem('issuegauge.pending');
    pendingTx = undefined;
    preparedReview = undefined;
    el('#fee-panel').hidden = true;
    const id = BigInt(String(await client.readContract({ address: current.address, functionName: 'get_review_count', args: [] }))) - 1n;
    el('#review-id').value = id.toString();
    await loadReview(id);
    setActivity(`Review ${id.toString()} finalized on ${networks[networkKey].label}. Transaction: ${txUrl}`);
  } catch (error) {
    setActivity(error instanceof Error ? error.message : `Could not confirm the final status. Track the submitted transaction: ${txUrl}`, true);
  } finally {
    el('#submit-review').disabled = false;
    updatePrepareState();
  }
}

el('#connect-wallet').addEventListener('click', connectWallet);
el('#review-form').addEventListener('submit', prepareReview);
el('#submit-review').addEventListener('click', submitReview);
el('#issue-url').addEventListener('input', updatePrepareState);
el('#public-consent').addEventListener('change', updatePrepareState);
addressInput.addEventListener('change', () => {
  if (getAddress()) localStorage.setItem('issuegauge.contract', getAddress());
  updateUrl();
  loadCount();
  showPendingNotice();
  updatePrepareState();
});
el('#lookup-button').addEventListener('click', async () => {
  try { await loadReview(parseId(el('#review-id').value)); }
  catch (error) { setActivity(error instanceof Error ? error.message : 'Could not load the review.', true); }
});
el('#latest-button').addEventListener('click', async () => {
  try {
    const count = BigInt(String(await readClient().readContract({ address: getAddress(), functionName: 'get_review_count', args: [] })));
    if (count === 0n) throw new Error('This contract has no stored reviews yet.');
    await loadReview(count - 1n);
  } catch (error) { setActivity(error instanceof Error ? error.message : 'Could not load the latest review.', true); }
});
el('#review-id').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); el('#lookup-button').click(); }
});
networkSelect.addEventListener('change', () => {
  networkKey = networkSelect.value;
  localStorage.setItem('issuegauge.network', networkKey);
  params.set('network', networkKey);
  updateUrl();
  if (account) {
    account = '';
    client = undefined;
    el('#wallet-status').textContent = 'Reconnect wallet to the selected network';
    el('#connect-wallet').innerHTML = 'Connect wallet <span>↗</span>';
  }
  preparedReview = undefined;
  el('#fee-panel').hidden = true;
  el('#network-status').textContent = networks[networkKey].label;
  loadCount();
  showPendingNotice();
  updatePrepareState();
});

if (getAddress()) {
  localStorage.setItem('issuegauge.contract', getAddress());
  loadCount();
  showPendingNotice();
}
updatePrepareState();
