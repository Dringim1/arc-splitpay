# PaymentSplitter.sol - Security Review Notes

**Contract:** `contracts/PaymentSplitter.sol`
**Chain target:** Arc Mainnet (chain ID 5042)
**USDC address:** `0x3600000000000000000000000000000000000000`
**Review methods:** Tool-assisted review, Slither, and 26 Foundry unit/fuzz/invariant tests
**Date:** 2026-10-17
**Status: Review notes only. This is not a formal independent security audit. Mainnet deployment and end-to-end verification remain outstanding.**

---

## Fixes Applied This Iteration

### Fix 1 - Griefing DoS via `balanceOf()` (Critical - FIXED)

**Original code:**
```solidity
if (token.balanceOf(address(this)) != 0) revert TransferFailed();
```
**Problem:** Any account could call `token.transfer(splitterAddress, 1)` to deposit 1 unit of USDC into the contract at any time. After that, the global-balance check would always evaluate to non-zero even after a perfectly correct distribution, reverting every future `splitPayment` call permanently. The contract was griefable with a single 1-wei transfer.

**Fix:** Replaced with a pure arithmetic invariant:
```solidity
uint256 pushed = 0;
for (uint256 i = 0; i < len; ++i) {
    if (!token.transfer(recipients[i], shares[i])) revert TransferFailed();
    pushed += shares[i];
}
if (pushed != amount) revert TransferFailed();
```
`pushed` is the sum of all shares computed from `amount` and the bps array. By construction `sum(shares) == amount` (the share arithmetic guarantees this), so this check always passes on a correctly computed distribution, and it never reads an external balance. Unsolicited deposits are permanently irrelevant.

### Fix 2 - `ShareTooSmall` rejects legitimate tiny splits (High - FIXED)

**Original code:**
```solidity
uint256 share = (amount * bps[i]) / 10_000;
if (share == 0) revert ShareTooSmall();
```
**Problem:** For small amounts (e.g. `amount=3, bps=[3334,3333,3333]`), integer division floors some intermediate shares to 0. The intent of the design is for all dust to go to the last recipient. The revert was inconsistent with that intent.

**Fix:** Removed the `ShareTooSmall` guard entirely. Non-last shares may be 0. The last recipient absorbs `amount - sum(non-last shares)`, which is always >= 0 (proved by the bps constraint: `sum(bps) = 10_000` so `sum(floor(amount * bps[i] / 10_000)) <= amount`). The `ZeroAmount` guard already prevents `amount=0`.

**Effect:** `amount=1, bps=[5000,5000]` now correctly gives shares `[0, 1]`. The last recipient always gets at least 1 unit when `amount >= 1`.

### Fix 3 - Explicit `= 0` initializers for local accumulators (Medium Slither - FIXED)

Added explicit `= 0` to `bpsSum`, `distributed`, and `pushed`. Behaviour is identical in Solidity >= 0.8 (all locals are zero-initialized), but Slither's `uninitialized-local` detector fired on these. The fix silences the Medium finding without any semantic change.

---

## Findings Table

| # | Source | Severity | Finding | Status | Evidence |
|---|---|---|---|---|---|
| 1 | Functional auditor (round 1) | Critical | `balanceOf()` check - griefing DoS | **Fixed** | Fix 1 above; the patched logic was re-reviewed |
| 2 | Functional auditor (round 1) | High | `ShareTooSmall` rejects legitimate dust splits | **Fixed** | Fix 2 above; 26 tests re-run, all pass |
| 3 | Slither (round 1) | Medium | `uninitialized-local` on `bpsSum`, `distributed`, `pushed` | **Fixed** | Explicit `= 0`; Slither round 2 confirms removed |
| 4 | Slither (round 2) | Medium | `calls-loop`: `token.transfer()` inside loop | **Accepted** | See analysis below |
| 5 | Slither (round 2) | Low | `reentrancy-events`: event after external calls | **Accepted (false positive)** | See analysis below |
| 6 | Slither (round 2) | Informational | `cyclomatic-complexity` | **Accepted** | Style only |

---

## Accepted Finding Analysis

### Finding 4: `calls-loop` (Medium) - ACCEPTED

Slither flags `token.transfer()` inside the distribution loop as a risk because a failed or reverting recipient can block the whole transaction.

**Why accepted:** The contract is intentionally atomic. If any transfer fails, the entire split reverts, preserving the sender's funds (the `transferFrom` itself is already done at that point - but a revert undoes all state changes including that pull). The caller bears responsibility for choosing recipients that can receive ERC-20 tokens. No attacker-controlled path can use this to steal funds; it can only cause a legitimate caller who picks a bad recipient to have their transaction revert. The constraint is documented in the NatDoc.

There is no non-atomic alternative that preserves the stateless contract design and the guarantee that recipients always receive their exact computed shares simultaneously.

### Finding 5: `reentrancy-events` (Low) - FALSE POSITIVE

Slither detects that `PaymentSplit` is emitted after external calls (`transferFrom` and `transfer`). This is the `reentrancy-events` detector, which only concerns event ordering in the presence of reentrancy - it is NOT a fund-safety issue.

The contract is stateless: there are no storage variables. A re-entrant call to `splitPayment` from a recipient's `onERC20Received` hook would be a fully independent transaction drawing from the re-entrant caller's own USDC balance. It cannot double-spend the outer call's pulled funds (those are in the contract and being distributed). The test suite includes invariant and reentrancy-related tests. Passing tests support the tested scenarios but do not prove the absence of every reentrancy risk.

---

## Tool-Assisted Solidity Review (round 2)

The round-2 tool-assisted review reported no additional material findings. The accepted Slither findings listed above remain documented. This was not an independent security audit.

Key properties confirmed:
- CEI ordering: all computation and share arrays are final before the first external call (`transferFrom`). No state can be manipulated by reentrancy.
- ERC-20 return values: both `transferFrom` and `transfer` check the `bool` return and revert on `false`.
- bps arithmetic: `bpsSum != 10_000` is enforced. Solidity 0.8 checked arithmetic reverts if `amount * bps[i]` overflows, so extremely large amounts may revert rather than distribute.
- Subtraction safety: `distributed` accumulates shares that do not exceed `amount`, so `amount - distributed` cannot underflow when the share calculations succeed.
- No admin, no fees, no upgradeability.

---

## Test Results

**26 / 26 passed. 0 failed. 0 skipped.**
Includes 256-run fuzz campaigns and a 128,000-call invariant suite.

| Test | Result |
|---|---|
| 2-recipient equal split, event verified | PASS |
| 3-recipient unequal split | PASS |
| Dust absorption: `amount=3, bps=[3334,3333,3333]` | PASS |
| Extreme dust: `amount=1, bps=[5000,5000]` -> shares `[0,1]` | PASS |
| Large-amount dust to last recipient | PASS |
| Minimal bps `[9999, 1]` | PASS |
| Revert: `ZeroAmount` | PASS |
| Revert: `InvalidRecipientCount` (1 and 4 recipients) | PASS |
| Revert: `LengthMismatch` | PASS |
| Revert: `InvalidBps` (sum != 10000, sum > 10000, zero bps) | PASS |
| Revert: `ZeroAddress` (first and second recipient) | PASS |
| Revert: `DuplicateRecipient` (2- and 3-element, adjacent and non-adjacent) | PASS |
| Revert: `TransferFailed` (no allowance) | PASS |
| Griefing immunity: unsolicited USDC deposit before call | PASS |
| Fuzz: 2-recipient sum-of-shares == amount (256 runs) | PASS |
| Fuzz: 3-recipient sum-of-shares == amount (256 runs) | PASS |
| Invariant: splitter holds zero USDC after any call (128,000 calls) | PASS |

---

## Security Assumptions for Mainnet Use

Before deploying with real USDC, you should understand these assumptions:

1. **USDC address is hardcoded.** The contract will only work on Arc Mainnet. Do not deploy to any other chain without audit.
2. **The caller must `approve()` before calling `splitPayment`.** The approval must cover at least `amount`. If the approval is less, `transferFrom` reverts and the call fails atomically (no partial distribution).
3. **Recipients must be able to receive ERC-20 tokens.** If any recipient is a contract that rejects ERC-20 transfers, the entire split will revert. Choose recipients carefully.
4. **No admin, no pause, no upgrade.** Once deployed, the contract cannot be stopped or modified.
5. **Dust goes to the last recipient.** For very small amounts with unequal splits, the last recipient may receive more than their nominal percentage. For practical USDC amounts (>= $0.01 = 10,000 uUSDC), rounding dust is at most a few uUSDC per recipient.
6. **Stateless contract.** No funds are ever held between transactions. Either the full distribution succeeds in one atomic call, or nothing changes.

---

## Review Provenance

| Reviewer/tool | Dispatched | Files reviewed | Corpus rules cited |
|---|---|---|---|
| solidity-auditor | yes (round 2) | 1 | none |
| functional-auditor | yes (round 2) | 1 | - |
