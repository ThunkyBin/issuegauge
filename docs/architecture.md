# Architecture and review rubric

1. The browser validates the URL for fast feedback; the contract repeats full validation. Only standard public GitHub issue URLs are accepted.
2. A non-deterministic block fetches the matching issue object from GitHub's public REST API and extracts a bounded title/labels/body excerpt. That excerpt is sent to GenLayer validators for assessment; it is never written to contract storage.
3. The leader and validators independently classify issue type and check the same four evidence fields. Validators must agree exactly on those fields before the write proceeds.
4. The readiness score and checklist suggestion are derived deterministically from the four agreed booleans.
5. Contract state stores the canonical issue URL, classification, checklist, score, and fixed suggestion. It does not copy issue text, mutate GitHub, or make a maintainer decision.
6. The client simulates before proposing a transaction, waits for the wallet's authorization, and tracks a pending hash in local storage to discourage duplicate submissions.
