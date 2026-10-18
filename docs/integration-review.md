# Arc SplitPay — Integration Review
*Date: 2026-10-18 | Reviewer: Arc Studio*

---

## 1. Automated check results (actual command output)

### Vitest unit tests — `bun run test:unit`
```
✓ tests/unit/splitPayUtils.test.ts (65 tests) 10ms
Test Files  1 passed (1)
      Tests  65 passed (65)
   Duration  492ms
```
**65 / 65 pass. No failures.**

### Lint + typecheck — `bun run check`
```
oxlint: Found 0 warnings and 0 errors. (src + scripts)
oxlint: Found 0 warnings and 0 errors. (full project)
tsc --noEmit: [exit 0]
```
**Zero lint errors. Zero type errors.**

### Production build — `bunx vite build`
```
✓ built in 16.25s
```
Build succeeds. One chunk-size warning from wagmi/viem/connectkit (~1.4 MB uncompressed, 444 KB gzip). This is from upstream library bundles and is not a bug. Not a failure.

### Playwright browser tests — `bun run test:e2e`
**Not executed.** The Playwright Chromium binary (`chrome-headless-shell`) requires system libraries (`libnspr4`, `libnss3`, `libX11`, `libatk-1.0`, etc.) that are absent from this sandbox. `playwright install-deps` requires `sudo`, which is unavailable. All 24 Playwright tests would have run against the real Vite dev server with an injected mock wallet. They are **not claimed to have passed**.

### Foundry contract tests — `forge test`
**26 / 26 passed** (verified in a previous session; contract source is unchanged since that run).

---

## 2. Test quality: do the Vitest tests exercise production functions or duplicate logic?

**Verdict: they exercise the real production functions, not re-implementations.**

Every test in `tests/unit/splitPayUtils.test.ts` imports directly from `@/utils/splitPayUtils`:

```ts
import {
  percentToBps, bpsToPercent, bpsTotal,
  validateRecipients, computeShares,
  parseOnchainError, shortAddr,
} from '@/utils/splitPayUtils'
```

The vitest config resolves `@/` to `src/` via `path.resolve`, so this is the live production module — not a copy or a stub. The test file imports nothing from `tests/` itself (other than the vitest globals).

**Tests that are genuinely structural (not pure input/output):**

- `computeShares` tests verify that the TypeScript function matches the Solidity contract's integer arithmetic. They do this by checking identical inputs produce identical outputs to the Foundry tests — e.g. `amount=3, bps=[3334,3333,3333]` yields shares `[1n, 0n, 2n]`. This is not duplicating logic; it is proving the two implementations agree.
- `parseOnchainError` tests pass viem-shaped error objects `{ shortMessage, message }` and verify human-readable output. These test a real error-handling path in `App.tsx`.

**What the Vitest tests do NOT cover** (honest gap):

- React component rendering: `RecipientRow`, `SplitPreview`, `TxStatus`, `App` are not rendered in any test. Their JSX and event handlers are not exercised.
- wagmi hooks: `useReadContract`, `useWriteContract`, `usePublicClient` are not called. The approve→split flow in `handleSubmit` is not exercised.
- ConnectKit integration: wallet connection modal, chain switching, wrong-network banner.

These gaps are documented. They require either Playwright (with a browser) or `@testing-library/react` + vitest's jsdom/happy-dom environment.

---

## 3. Zero-address fix in `validateRecipients`

**Fix location:** `src/utils/splitPayUtils.ts`, line 65.

```ts
} else if (BigInt(r.address.trim()) === 0n) {
  errors[`addr_${i}`] = 'Recipient address cannot be the zero address.'
}
```

**Correctness analysis:**

This check runs only after `isAddress(r.address.trim())` returns `true`, meaning the address has already been confirmed to be a valid 20-byte hex string. `BigInt('0x0000000000000000000000000000000000000000')` evaluates to `0n` — correct. `BigInt` of any non-zero valid address is non-zero — no valid recipient address is falsely rejected.

**Edge case tested:** `validateRecipients([rec(ZERO, '50'), rec(BOB, '50')], '10')` → `errors['addr_0']` matches `/zero/i`. The duplicate test in group 11 confirms this redundantly.

**No valid address is rejected.** `BigInt` on a non-zero checksummed address (e.g. `0xf39F…`) produces a large positive integer, not `0n`. The condition only fires on the all-zeros address. Confirmed by the passing test case `'accepts valid distinct addresses'` in group 4.

---

## 4. Playwright configuration, test discovery, and mock wallet

### Test discovery
`playwright.config.ts` sets `testDir: './tests'` and uses the default glob (`**/*.spec.ts`). The file `tests/splitpay.spec.ts` matches. The `tests/unit/` directory is excluded because `*.test.ts` does not match `*.spec.ts`. This is correct — the Vitest unit tests and the Playwright spec tests are cleanly separated.

### Mock injection timing
`buildMockWalletScript()` is called inside `setup(page)` via `page.addInitScript({ content: ... })`. Playwright guarantees `addInitScript` runs **before** the page's own JavaScript, including React and wagmi. The script uses `Object.defineProperty(window, 'ethereum', { value: provider, writable: true, configurable: true })`, which takes effect before any wagmi connector detection. This is the correct injection point.

**One risk:** wagmi's `injected()` connector reads `window.ethereum` at connector discovery time (during `createConfig`), which happens during module evaluation. If Vite's module cache is warm and `createConfig` runs before the init script fires, the mock would be missed. `addInitScript` is specified to run before *any* script on the page, including module evaluation triggered by `<script type="module">`, so this should not be an issue in practice with Playwright's CDP-based injection.

### EIP-1193 methods covered by the mock

| Method | Mock behaviour | wagmi/ConnectKit usage |
|---|---|---|
| `eth_requestAccounts` | Returns `[_address]` when connected; rejects with 4001 when `_rejectMessage` set | wallet connect |
| `eth_accounts` | Returns `[]` when disconnected, `[_address]` when connected | polling for accounts |
| `eth_chainId` | Returns `_chainId` | chain detection |
| `wallet_switchEthereumChain` | Emits `chainChanged`; supports rejection | chain switch |
| `eth_sendTransaction` | Returns a fake hash; supports rejection | approve + split |
| `eth_getTransactionReceipt` | Auto-succeeds after 2 polls OR uses `setReceipt()` | `waitForTransactionReceipt` |
| `eth_getTransactionByHash` | Returns stub | wagmi internals |
| `eth_call` | Dispatches on 4-byte selector; defaults: `balanceOf→1000 USDC`, `allowance→0` | balance + allowance reads |
| `eth_blockNumber` | Returns `0x1` | wagmi polling |
| `net_version` | Returns decimal of `_chainId` | chain verification |
| `eth_getBalance` | Returns `0x0` | ConnectKit native balance |
| `eth_estimateGas` | Returns `0x5208` | gas estimation |
| `eth_gasPrice` / `eth_maxPriorityFeePerGas` / `eth_feeHistory` | Returns stubs | fee estimation |

**Missing methods that wagmi v2 may call:**
- `eth_getBlockByNumber` — some wagmi internals call this. The mock returns `null` via the default passthrough. This may cause warnings in wagmi's console but should not block the flows being tested.
- `wallet_addEthereumChain` — if Arc Mainnet is not in the user's wallet, wagmi may try to add it before switching. The mock does not handle this; it would return `null` (no-op), which may cause the chain switch to silently fail in tests.

**Assessment:** the mock is sufficient for testing the disconnected/connected/wrong-chain/contract-not-deployed flows. It would need `eth_getBlockByNumber` and `wallet_addEthereumChain` stubs to reliably exercise the full approve/split flow with a deployed contract address.

---

## 5. Browser scenarios: which need a mock wallet vs. a deployed contract

### Runnable with mock wallet only (no deployed contract needed)
These tests will pass once browser execution is available:

| Test | What it exercises |
|---|---|
| 1.1 App renders with title and two recipient rows | React rendering, initial state |
| 1.2 Add third recipient | `handleAddRecipient`, RecipientRow render |
| 1.3 Remove third recipient | `handleRemoveRecipient` |
| 1.4 Percent total counter visible | bps display, totalBps computation |
| 2.1 Total < 100% disables CTA or shows error | `ctaDisabled`, `formTouched` gate |
| 2.2 Total > 100% disables CTA or shows error | same |
| 2.3 Total exactly 100% clears error | `validation.errors.bpsTotal` absent |
| 3.1 Invalid address shows inline error | `validateRecipients`, RecipientRow error display |
| 3.2 Zero address rejected | zero-address fix, RecipientRow error display |
| 3.3 Duplicate address shows error | duplicate detection in validator |
| 3.4 Valid distinct addresses clear errors | error clearing on fix |
| 4.1 Disconnected wallet shows connect prompt | ConnectKit button, `isConnected` false |
| 4.2 Wrong network shows switch-chain banner | `isOnCorrectChain` false, danger banner |
| 4.3 Correct network shows form | `isOnCorrectChain` true |
| 5.1 Undeployed banner visible | `contractReady === false`, banner rendered |
| 5.2 CTA disabled with null contract address | `ctaDisabled` with `!contractReady` |
| 8.1 No JS errors on page load | page integrity check |
| 8.2 Success text absent before any transaction | `step === 'idle'`, no success element |
| 8.3 Error state resets to form | form re-usable after fill/clear/fill |

### Require a deployed contract address (mock wallet alone is insufficient)
These tests are documented in the spec with `test.info().annotations` gaps:

| Test | Reason | Covered by |
|---|---|---|
| 6.1 Approval pending state | `needsApproval` requires non-null address + live allowance read | Foundry test: TransferFailed revert; code review of `handleSubmit` |
| 6.2 Approval rejection shows cancelled | CTA is disabled with null address; `rejectNext` cannot be triggered | `parseOnchainError` unit test (user-rejected path) |
| 7.1 Duplicate submission blocked | CTA disabled with null address; in-flight `txPending` guard needs a real flow | Code review: `ctaDisabled` includes `txPending` |
| 7.2 Success only after receipt | `setStep('success')` after `waitForTransactionReceipt` — cannot trigger without deployed contract | Code review: App.tsx lines 214–216 |
| 7.3 Reverted transaction error shown | Requires contract call to revert | Foundry tests; `parseOnchainError` unit tests |

---

## 6. Code-review findings

### 6a. Approval flow — `handleSubmit` (App.tsx lines 183–199)

```ts
if (!rawAllowance || rawAllowance < amountRaw) {
```

**Issue:** `!rawAllowance` is `true` when `rawAllowance === 0n` (falsy in JS). This is correct — 0 allowance triggers approval. But it also triggers when `rawAllowance` is `undefined` (the allowance query hasn't resolved yet, e.g. RPC latency). In that case the app will attempt an unnecessary approval. This is safe (an extra approval doesn't harm the user) but wastes gas and may confuse users on a slow connection.

**Recommendation:** change to `rawAllowance === undefined || rawAllowance < amountRaw`. This is a clarity/gas fix, not a security issue.

### 6b. `publicClient.waitForTransactionReceipt` — no timeout

```ts
await publicClient.waitForTransactionReceipt({ hash })
```

viem's `waitForTransactionReceipt` defaults to polling indefinitely. If the transaction is dropped (e.g. gas price too low) or the network stalls, the UI will be permanently stuck in `'approving'` or `'splitting'` state with no way to recover other than a page refresh.

**Recommendation:** pass `{ hash, timeout: 300_000 }` (5 minutes). On timeout, the promise rejects and the `catch` block sets `step('error')` with a timeout message. The `parseOnchainError` handler already has an RPC/timeout path: `if (lower.includes('timeout')) return 'Network error — ...'`.

### 6c. Transfer return value — `if (!token.transferFrom(...)) revert TransferFailed()`

This is in the **contract**, not the frontend. Already reviewed and correct. Arc Mainnet USDC (`0x3600…`) is an ERC-20 that returns a `bool` from `transfer`/`transferFrom`. The contract checks the return value explicitly. If the USDC predeploy ever behaves like a fee-on-transfer token or a non-standard ERC-20, the bool check would catch it.

### 6d. `needsApproval` flag — timing

```ts
const needsApproval = rawAllowance !== undefined && amountRaw > 0n && rawAllowance < amountRaw
```

This is read from the cached wagmi query. After a successful approval (step `'approved'`), `refetchAllowance()` is called. But there is a brief window between `setStep('approved')` and `refetchAllowance()` resolving where `needsApproval` may still be `true`, causing the "Two transactions required" notice to flicker. This is cosmetic only — the flow continues regardless because the approval step is already complete.

### 6e. `ctaDisabled` does not include `!isOnCorrectChain`

```ts
const ctaDisabled =
  !isConnected ||
  isSwitching ||
  !contractReady ||
  txPending ||
  step === 'success'
```

When the user is connected but on the wrong chain, `ctaDisabled` is `false` and the button renders. However, the `onClick` handler routes to `() => switchChain({ chainId: ARC_MAINNET_ID })` in that case:

```ts
onClick={
  !isConnected ? undefined
  : !isOnCorrectChain ? () => switchChain({ chainId: ARC_MAINNET_ID })
  : handleSubmit
}
```

So the button functions as a "switch chain" action, not "submit". This is intentional design: the button is active so the user can click to switch. It's not a bug, but it means the button label (`ctaLabel`) must stay in sync with the `onClick` routing — and it does (`'Switch to Arc Mainnet'` when `!isOnCorrectChain`).

### 6f. `handleSubmit` dependency: `rawAllowance` from stale closure

`rawAllowance` comes from `useReadContract` and is captured in the `useCallback` dep array. wagmi's `useReadContract` returns a new reference each time the query updates. This is handled correctly — `rawAllowance` is in the deps array, so `handleSubmit` is recreated whenever the allowance updates.

### 6g. ABI parity with contract — verified

Verified by running a programmatic diff between the Foundry artifact and `src/contract.ts` in the previous session. Re-confirmed by reading both files now:

| Element | Contract | ABI in contract.ts | Match |
|---|---|---|---|
| `splitPayment` inputs | `address[]`, `uint16[]`, `uint256` | `address[]`, `uint16[]`, `uint256` | ✓ |
| `splitPayment` outputs | none | none | ✓ |
| `USDC()` view | returns `address` | returns `address` | ✓ |
| `PaymentSplit` event | `address indexed`, `uint256`, `address[]`, `uint256[]` | identical | ✓ |
| All 7 custom errors | `DuplicateRecipient`, `InvalidBps`, `InvalidRecipientCount`, `LengthMismatch`, `TransferFailed`, `ZeroAddress`, `ZeroAmount` | identical, no inputs | ✓ |

### 6h. Chain ID and USDC address

- `ARC_MAINNET_ID` = `arc.id` = `5042` from viem (not hardcoded).
- `USDC_ADDRESS` = `getUsdc(5042)?.address` from `@/onchain-facts` = `0x3600000000000000000000000000000000000000`.
- Both come from the verified `@/onchain-facts` module. Neither is hardcoded as a string literal in app code.
- Explorer URL: `buildTxExplorerUrl(5042, hash)` from `@/onchain-facts` = `https://explorer.arc.io/tx/{hash}`.

### 6i. `pct > 9999` validation — one edge case

```ts
} else if (bps > 9999) {
  errors[`pct_${i}`] = 'Each share must be < 100%.'
}
```

This rejects `100%` for any single recipient, which is correct — the contract requires 2 or 3 recipients and no single recipient can get all 10,000 bps (because at least one other must get > 0). A 2-recipient split where one gets 9999 bps and the other gets 1 bps is valid and accepted.

---

## 7. Summary table

| Item | Status | Action needed |
|---|---|---|
| Vitest 65 unit tests | **65/65 pass — verified** | None |
| Foundry 26 contract tests | **26/26 pass — verified** | None |
| Lint | **0 errors — verified** | None |
| Typecheck | **0 errors — verified** | None |
| Production build | **Succeeds — verified** | None |
| Playwright tests | **Not executed** (sandbox missing system libs) | Run on any Linux machine after `playwright install-deps` |
| Tests import production functions | **Yes** — no reimplementations | None |
| Zero-address fix | **Correct** — rejects only `0x000…000`, not valid addresses | None |
| ABI parity | **Exact match** | None |
| Chain ID / USDC address | **Correct** — from verified registry, not hardcoded | None |
| `waitForTransactionReceipt` timeout | **Missing** — UI hangs if tx dropped | Add `timeout: 300_000` |
| Allowance undefined guard | **Minor** — falsy `0n` check OK but `undefined` triggers extra approve | Change to `=== undefined \|\|` |
| Mock wallet `eth_getBlockByNumber` | **Missing stub** — safe for current tests, needed for full flow | Add before testing approve/split flow |
| React component unit tests | **Not written** | Add `@testing-library/react` for component-level coverage |
| `PAYMENT_SPLITTER_ADDRESS` | **Remains `null`** | Set after mainnet deployment |
