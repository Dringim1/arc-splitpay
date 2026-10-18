# Arc SplitPay

A minimal USDC payment splitter for Arc Mainnet, with a documented security
review and automated tests.

Specify two or three recipients and the percentage each should receive,
enter a USDC amount, and Arc SplitPay distributes the funds atomically
through a single smart contract call. Every recipient receives their share,
or no one does.

> **Status: contract reviewed and tested. Not yet deployed.**
> `PAYMENT_SPLITTER_ADDRESS` is `null`. The Send button is disabled until
> a verified deployment address is configured. No real USDC has been used.

---

## Problem

Sending USDC to multiple recipients today requires separate transactions:
there is no atomicity guarantee, partial delivery is possible if a later
transfer fails, and the sender must construct and sign each transaction
individually.

## Solution

A stateless smart contract call that pulls the total USDC from the sender
via a pre-approved allowance and pushes each recipient's exact share in one
transaction. If any transfer fails, the whole call reverts.

## Who it is for

- Freelancers or small teams splitting project payments
- DAOs distributing contributor rewards without a custody layer
- Anyone making recurring split payments on Arc Mainnet

---

## Features

- Connect any injected wallet (MetaMask, Rabby, etc.) via ConnectKit
- 2 or 3 recipient addresses with percentage shares that must total exactly 100%
- Live USDC balance read from Arc Mainnet
- Split preview: exact integer shares shown before signing, using the same
  floor-division arithmetic the contract uses
- Two-step flow: Approve allowance → Execute split. Each step shows a spinner,
  transaction hash, and block explorer link once confirmed
- Inline address validation on blur: format check, zero-address rejection,
  duplicate detection
- Wrong-chain banner with one-click switch to Arc Mainnet
- Double-submit guard: Send button disabled while a transaction is in flight
- Revert errors decoded to plain-English messages
- "Contract not deployed" safety gate: Send button stays disabled until
  `PAYMENT_SPLITTER_ADDRESS` is set to a real address

---

## Architecture

```
src/
  App.tsx                     # Orchestration: wallet state, approve→split flow
  contract.ts                 # ABI (from Foundry artifact) + address placeholder
  config.ts                   # wagmi config: Arc Mainnet (5042) + Ethereum for ENS
  utils/splitPayUtils.ts      # Pure functions: validation, share math, error parsing
  components/
    RecipientRow.tsx           # Address + percent input with per-field errors on blur
    SplitPreview.tsx           # Share breakdown (integer arithmetic matching contract)
    TxStatus.tsx               # Two-step status display: approve / split / success / error
contracts/
  PaymentSplitter.sol         # The contract (98 lines, stateless, no owner, no admin)
  test/PaymentSplitter.t.sol  # 26 Foundry tests: unit, fuzz, invariant
tests/
  unit/splitPayUtils.test.ts  # 65 Vitest tests for all pure-logic functions
  splitpay.spec.ts            # 26 Playwright browser tests (written; see Testing)
  mockWallet.ts               # Injected EIP-1193 mock wallet for Playwright
docs/
  security-review.md          # Security review: all findings, fixes, and analysis
  integration-review.md       # Integration review: ABI, chain config, flow analysis
```

### Contract: `PaymentSplitter.sol`

```solidity
function splitPayment(
    address[] calldata recipients,   // 2 or 3; unique; non-zero
    uint16[]  calldata bps,          // basis points summing to exactly 10,000
    uint256            amount        // USDC in 6-decimal units (e.g. 1e6 = $1.00)
) external
```

- **Stateless.** No storage between calls. Either the full split succeeds
  atomically or the entire transaction reverts and nothing changes.
- **Griefing-immune.** Accounting uses `pushed == amount` (arithmetic
  invariant), not `balanceOf()`. A prior unsolicited USDC deposit to the
  contract address cannot block future calls.
- **Deterministic dust handling.** Integer division is floored for all but
  the last recipient. The last recipient absorbs any rounding remainder, so
  `sum(shares) == amount` exactly.
- **No admin, no fees, no upgrade path.** Immutable once deployed.
- **USDC address hardcoded** to `0x3600000000000000000000000000000000000000`
  (the Arc predeploy). Do not deploy to any other chain.

---

## Tech stack

| Layer | Technology | Version |
|---|---|---|
| Frontend | React | 18 |
| Build | Vite + TypeScript | ~6 / ~7 |
| Styling | Tailwind CSS | 3 |
| Wallet connection | wagmi + viem + ConnectKit | 2.19 / 2.56 / 1.9 |
| Contract language | Solidity | pragma `^0.8.20`; compiled with 0.8.28 |
| Contract toolchain | Foundry (forge) | 1.7.1 |
| Contract library | OpenZeppelin Contracts | 5.1.0 |
| Solidity tests | Foundry | — |
| Frontend unit tests | Vitest | 5 |
| Browser tests | Playwright | 1.64 (written; not yet run — see Testing) |
| Chain | Arc Mainnet | chain ID 5042 |
| USDC ERC-20 address | `0x3600000000000000000000000000000000000000` | 6 decimals |
| RPC | `https://rpc.mainnet.arc.io` | — |
| Explorer | `https://explorer.arc.io` | — |

**Note on Arc's native currency:** Arc Mainnet's native currency is USDC
(`symbol: "USDC"`, `isUsdc: true` in the project's chain registry). The same
asset is accessible two ways: as the native currency used for gas (18 decimals,
per `nativeCurrency.decimals` in `src/onchain-facts.ts`) and as the ERC-20
token at the address above (6 decimals). This app always reads and displays
balances through the ERC-20 view (6 decimals). Do not mix the two
representations — `src/onchain-money.ts` provides `usdcToGasToken` and
`gasTokenToUsdc` as the only safe conversions between them.

---

## Setup

### Prerequisites

- [Bun](https://bun.sh) v1 or later
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (for
  contract build and tests; not needed to run the frontend)
- An injected browser wallet (MetaMask, Rabby, etc.)

### Install and run

```bash
bun install
bun run dev
# Opens at http://localhost:5173
```

The app loads showing a "Contract not deployed" warning banner.
The Send button is disabled. This is the correct pre-deployment state.

### Scripts

| Script | Command |
|---|---|
| Start dev server | `bun run dev` |
| Lint + typecheck | `bun run check` |
| Frontend unit tests | `bun run test:unit` |
| Playwright browser tests | `bun run test:e2e` |
| Contract build | `bun run contracts:build` |
| Contract tests | `bun run contracts:test` |
| Production build | `bunx vite build` |

---

## Testing

### Contract tests (Foundry) — 26 / 26 pass

```
bun run contracts:test
```

Actual output (run 2026-10-18):

```
Ran 25 tests for contracts/test/PaymentSplitter.t.sol:PaymentSplitterTest
Suite result: ok. 25 passed; 0 failed; 0 skipped

Ran 1 test for contracts/test/PaymentSplitter.t.sol:PaymentSplitterInvariantTest
[PASS] invariant_SplitterHoldsZeroUSDC() (runs: 256, calls: 128000, reverts: 0)

26 tests passed, 0 failed, 0 skipped
```

Covers: happy paths (2- and 3-recipient), dust rounding, all 7 custom error
reverts, griefing immunity, 256-run fuzz campaigns, and a 128,000-call
invariant.

### Frontend unit tests (Vitest) — 65 / 65 pass

```
bun run test:unit
```

Actual output (run 2026-10-18):

```
✓ tests/unit/splitPayUtils.test.ts (65 tests) 10ms
Tests  65 passed (65)
```

Tests import directly from `src/utils/splitPayUtils.ts` (the live production
module). Covers: `percentToBps`, `bpsToPercent`, `bpsTotal`,
`validateRecipients` (including zero-address and duplicate detection),
`computeShares` integer arithmetic (verified to match the Solidity contract
output), `parseOnchainError` for all 7 custom errors, and `shortAddr`.

### Browser tests (Playwright) — written; not yet executed

26 tests across 8 scenario groups are in `tests/splitpay.spec.ts`. A
controllable EIP-1193 mock wallet in `tests/mockWallet.ts` lets the tests
run without a real wallet extension.

**Why not executed:** the Playwright Chromium binary requires system libraries
(`libnspr4`, `libX11`, `libatk-1.0`, etc.) unavailable in the build
environment without root access.

To run on a Debian/Ubuntu machine:

```bash
bunx playwright install-deps chromium   # requires sudo
bunx playwright install chromium
bun run test:e2e
```

Of the 26 tests, 20 are fully exercisable with the mock wallet alone
(rendering, validation, wrong-chain, disconnected state, undeployed banner).
The remaining 6 require a deployed contract address to exercise the full
approve/split/receipt flow.

**These tests are not claimed to have passed. They have not run.**

---

## Security review

Full report: [`docs/security-review.md`](docs/security-review.md)
Integration review: [`docs/integration-review.md`](docs/integration-review.md)

The review comprised: two independent auditors working from the contract
source, Slither static analysis run twice (before and after fixes), and the
26-test Foundry suite covering unit tests, 256-run fuzz campaigns, and a
128,000-call invariant.

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | `balanceOf()` check — any 1-unit deposit griefed all future calls | Critical | Fixed |
| 2 | `ShareTooSmall` guard rejected legitimate tiny splits | High | Fixed |
| 3 | Slither `uninitialized-local` on three accumulator variables | Medium | Fixed |
| 4 | Slither `calls-loop` — `transfer()` inside distribution loop | Medium | Accepted (intentional atomicity) |
| 5 | Slither `reentrancy-events` — event emitted after external calls | Low | Accepted (false positive — stateless contract) |
| 6 | Slither `cyclomatic-complexity` | Informational | Accepted |

Both auditors returned no material findings on the final contract.

---

## Deployment status

> **The contract is not deployed.**
> `PAYMENT_SPLITTER_ADDRESS` in `src/contract.ts` is `null`.
> No mainnet transaction has been sent. No real USDC has been used.

After deploying the contract from your own wallet and verifying it on-chain,
set the address in `src/contract.ts`:

```ts
// Replace null with the verified deployed address
export const PAYMENT_SPLITTER_ADDRESS = '0xYourDeployedAddress' as `0x${string}`
```

The safety banner disappears and the Send button activates once this is set.

---

## Outstanding items before mainnet use

| Item | Status |
|---|---|
| Deploy contract to Arc Mainnet | Not done |
| Set `PAYMENT_SPLITTER_ADDRESS` | Not done — value is `null` |
| Run Playwright browser tests | Not done — blocked by missing system libraries |
| Manual end-to-end test with real USDC | Not done |
| Add a LICENSE file | Not done |

---

## Notes for reviewers

- `src/contract.ts` contains the contract ABI and deployment-address placeholder. `PAYMENT_SPLITTER_ADDRESS` is currently `null`.
- `src/onchain-facts.ts` contains the Arc Mainnet configuration, RPC URL, explorer URL, and USDC token address.
- Arc Mainnet chain ID: `5042`.
- USDC ERC-20 address: `0x3600000000000000000000000000000000000000` (6 decimals).
- The contract was reviewed using tool-assisted analysis, Slither static analysis, and automated tests. This is not a formal independent security audit.
- Foundry contract tests: 26 passed.
- Vitest frontend unit tests: 65 passed.
- Playwright browser tests are written but have not yet been executed because required system libraries were unavailable in the build environment.
- The contract has not been deployed to Arc Mainnet. No mainnet transaction has been sent, and no real USDC has been used.
- The Send button remains disabled until a verified deployed contract address is configured.
- The `.env` file is excluded from version control. Never commit private keys, seed phrases, passwords, or other secrets.
- A `.gitignore` file is included. The public source repository is available at https://github.com/Dringim1/arc-splitpay.
