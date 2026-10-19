# Arc SplitPay

A minimal USDC payment splitter for Arc Mainnet, with a documented security
review and automated tests.

Specify two or three recipients and the percentage each should receive,
enter a USDC amount, and Arc SplitPay distributes the funds atomically
through a single smart contract call. Every recipient receives their share,
or no one does.

> **Status: deployed to Arc Mainnet. A real-USDC split has been verified end-to-end.**
> Contract: [`0xACef190f35C40C7E7e3Cf1aF4aD7b3dC60E35Dd1`](https://explorer.arc.io/address/0xACef190f35C40C7E7e3Cf1aF4aD7b3dC60E35Dd1)
> Deployment tx: [`0x61ddc287…cad4f9`](https://explorer.arc.io/tx/0x61ddc2879a8e9ba39dea4decfa216f04ba849bcee09f40a2ed7e7ca3d0cad4f9)
> Playwright browser tests have been written but have not been executed.

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
  contract.ts                 # ABI (from Foundry artifact) + deployed contract address
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

The app loads connected to the deployed contract on Arc Mainnet.
Connect a wallet on chain ID 5042 to use it.

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

### Live mainnet split — verified 2026-10-19

A real-USDC split was executed on Arc Mainnet and confirmed via the block
explorer. The app displayed "Payment split successfully."

| Field | Value |
|---|---|
| Network | Arc Mainnet (chain ID 5042) |
| Contract | `0xACef190f35C40C7E7e3Cf1aF4aD7b3dC60E35Dd1` |
| Split tx | [`0xd1b3c6f9…632e68`](https://explorer.arc.io/tx/0xd1b3c6f9c82d6a69de851aa1ed401213c94109d46a2f648e1b433dc607632e68) |
| Amount | 0.02 USDC |
| Recipients | 2 (50% / 50%) |
| Observed transfers | Sender → contract: 0.02 USDC; contract → recipient 1: 0.01 USDC; contract → recipient 2: 0.01 USDC |

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
(rendering, validation, wrong-chain, disconnected state). The remaining 6
exercise the full approve/split/receipt flow against the deployed contract.

**These tests are not claimed to have passed. They have not run.**

---

## Security review

Full report: [`docs/security-review.md`](docs/security-review.md)
Integration review: [`docs/integration-review.md`](docs/integration-review.md)

The contract was reviewed using tool-assisted analysis, Slither static analysis
(run twice, before and after fixes), and the 26-test Foundry suite covering unit
tests, 256-run fuzz campaigns, and a 128,000-call invariant. This is not a formal
independent security audit.

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | `balanceOf()` check — any 1-unit deposit griefed all future calls | Critical | Fixed |
| 2 | `ShareTooSmall` guard rejected legitimate tiny splits | High | Fixed |
| 3 | Slither `uninitialized-local` on three accumulator variables | Medium | Fixed |
| 4 | Slither `calls-loop` — `transfer()` inside distribution loop | Medium | Accepted (intentional atomicity) |
| 5 | Slither `reentrancy-events` — event emitted after external calls | Low | Accepted (false positive — stateless contract) |
| 6 | Slither `cyclomatic-complexity` | Informational | Accepted |

No material findings were identified on the final contract.

---

## Deployment

| Item | Value |
|---|---|
| Network | Arc Mainnet (chain ID 5042) |
| Contract address | [`0xACef190f35C40C7E7e3Cf1aF4aD7b3dC60E35Dd1`](https://explorer.arc.io/address/0xACef190f35C40C7E7e3Cf1aF4aD7b3dC60E35Dd1) |
| Deployment tx | [`0x61ddc287…cad4f9`](https://explorer.arc.io/tx/0x61ddc2879a8e9ba39dea4decfa216f04ba849bcee09f40a2ed7e7ca3d0cad4f9) |
| USDC address | `0x3600000000000000000000000000000000000000` |
| `PAYMENT_SPLITTER_ADDRESS` in `src/contract.ts` | Set to the address above |

The contract address was verified on-chain before being set: `eth_getCode`
confirmed deployed bytecode, and `USDC()` returned
`0x3600000000000000000000000000000000000000`.

---

## Outstanding items

| Item | Status |
|---|---|
| Deploy contract to Arc Mainnet | Done — `0xACef190f35C40C7E7e3Cf1aF4aD7b3dC60E35Dd1` |
| Set `PAYMENT_SPLITTER_ADDRESS` | Done — configured in `src/contract.ts` |
| Real-USDC split verified end-to-end | Done — [tx `0xd1b3c6f9…632e68`](https://explorer.arc.io/tx/0xd1b3c6f9c82d6a69de851aa1ed401213c94109d46a2f648e1b433dc607632e68) |
| Run Playwright browser tests | Not done — blocked by missing system libraries |
| Add a LICENSE file | Not done |

---

## Notes for reviewers

- `src/contract.ts` — ABI extracted verbatim from the Foundry artifact
  (`contracts/out/PaymentSplitter.sol/PaymentSplitter.json`), verified to
  match the contract source exactly.
- `src/onchain-facts.ts` — generated module containing Arc Mainnet chain
  config, RPC URL, explorer URL, and USDC address. Do not edit manually.
- The `.env` file must not be committed. It contains sandbox-internal
  configuration; no application secrets are required to run the app locally.
- A `.gitignore` is included.
