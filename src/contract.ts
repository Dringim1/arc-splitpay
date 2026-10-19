/**
 * PaymentSplitter contract configuration.
 *
 * ABI is derived from the Foundry artifact at
 * contracts/out/PaymentSplitter.sol/PaymentSplitter.json — do not edit manually.
 *
 * CONTRACT ADDRESS: fill in after deployment and verification.
 * Replace the placeholder below with the verified on-chain address before use.
 * The app renders a visible warning banner until a real address is set.
 */

// ─── ABI (extracted verbatim from the Foundry artifact) ─────────────────────

export const PAYMENT_SPLITTER_ABI = [
  {
    type: 'function',
    name: 'USDC',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'splitPayment',
    inputs: [
      { name: 'recipients', type: 'address[]', internalType: 'address[]' },
      { name: 'bps', type: 'uint16[]', internalType: 'uint16[]' },
      { name: 'amount', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'PaymentSplit',
    inputs: [
      { name: 'sender', type: 'address', indexed: true, internalType: 'address' },
      { name: 'totalAmount', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'recipients', type: 'address[]', indexed: false, internalType: 'address[]' },
      { name: 'shares', type: 'uint256[]', indexed: false, internalType: 'uint256[]' },
    ],
    anonymous: false,
  },
  { type: 'error', name: 'DuplicateRecipient', inputs: [] },
  { type: 'error', name: 'InvalidBps', inputs: [] },
  { type: 'error', name: 'InvalidRecipientCount', inputs: [] },
  { type: 'error', name: 'LengthMismatch', inputs: [] },
  { type: 'error', name: 'TransferFailed', inputs: [] },
  { type: 'error', name: 'ZeroAddress', inputs: [] },
  { type: 'error', name: 'ZeroAmount', inputs: [] },
] as const

// ─── Address placeholder ─────────────────────────────────────────────────────
//
// Replace with the verified Arc Mainnet deployment address.
// Example: export const PAYMENT_SPLITTER_ADDRESS = '0xYourDeployedAddress' as `0x${string}`
//
// Until this is set the app shows a "Contract not deployed" banner and
// disables the Send button.

export const PAYMENT_SPLITTER_ADDRESS: `0x${string}` | null =
  '0xACef190f35C40C7E7e3Cf1aF4aD7b3dC60E35Dd1'
