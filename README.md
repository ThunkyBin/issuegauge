# IssueGauge

IssueGauge is an open-source GenLayer application for reviewing the completeness of public GitHub issues. It helps maintainers and contributors spot missing context before a person spends time investigating a report.

**Live app:** https://thunkybin.github.io/issuegauge/ (after GitHub Pages deployment)  
**Network:** GenLayer test networks only; the app defaults to Studionet.  
**Status:** public testnet prototype, not a moderation bot.

## What it checks

The contract reads one public GitHub issue and asks the leader and validators to assess the same four checklist items:

- Is the problem or request clear?
- Are reproduction steps or feature acceptance criteria present?
- Is relevant version, environment, workflow, or component context present?
- Is there useful supporting evidence, or a clear reason it does not apply?

The contract derives a score from 0 to 80 from those four agreed fields and builds a suggestion from the missing checklist items without repeating issue text. `READY` means all four checklist items passed, `NEEDS_DETAIL` means some are missing, and `UNCLEAR` means the issue could not be assessed.

## How GenLayer is used

`review_issue(issue_url)` accepts only a standard `https://github.com/{owner}/{repo}/issues/{number}` URL and fetches the matching issue object from GitHub's public REST API inside a non-deterministic block. A bounded excerpt of the title, labels, and body is sent to GenLayer validators for assessment. The leader and each validator independently run the same rubric; a write succeeds only when they agree on the issue kind and the four checklist fields. The URL and result are public on-chain data; the issue text is not stored by the contract. The app simulates a write first, then lets the connected wallet show and approve any test-network fee.

The UI supports read-only lookups by contract address and review ID. Review links contain the selected network, contract, and ID so another person can load the same on-chain record.

## Local development

Requirements: Node.js 22+ and Python 3.12 with GenLayer's `genlayer-test` and `genvm-linter` packages.

```powershell
npm ci
npm run dev
```

The contract tests use mocked web and LLM responses; they do not publish issues, need a wallet, or send transactions.

```powershell
python -m pytest -q
python -m genvm_linter check contracts/issue_gauge.py
npm run build
```

## Deploy to a test network

Deploy `contracts/issue_gauge.py` from GenLayer Studio or the GenLayer CLI to Studionet first. The app supports Studionet (chain 61999) and the Bradbury and Asimov test networks (chain 4221). Paste the deployed contract address into the app, connect an EVM wallet, and check the selected test network and any fee in the wallet before approving a review.

The contract URL and result are permanently public after a successful write. The contract does not store the fetched issue body. Do not submit a private, sensitive, or unpublished issue. The assessment is advisory only and never changes the GitHub issue.

## Security and limitations

- The contract rejects non-GitHub domains, pull requests, credentials, explicit ports, query strings, fragments, malformed paths, and nonnumeric issue identifiers.
- Issue-page text is untrusted input. The prompt treats embedded directions as data and limits the fetched excerpt.
- Validators may disagree about natural-language evidence. `UNCLEAR` is preferable to pretending an issue page was assessed when fetching or parsing fails.
- Consensus does not prove that a report is true, that a bug exists, or that a maintainer should accept or prioritize it.
- The app never asks for seed phrases, private keys, passwords, or GitHub credentials.

## License

MIT
