/**
 * Unit tests for splitPayUtils.ts — pure logic, no browser required.
 * Covers Groups 1-3, 5, 8 from the integration test plan:
 *   - Percentage/bps conversion and validation
 *   - Address validation (invalid, zero, duplicate)
 *   - Share arithmetic (matching Solidity integer math exactly)
 *   - Error message parsing for all onchain revert types
 *   - Amount validation
 *
 * Run: bun run test:unit
 */

import { describe, it, expect } from 'vitest'
import {
  percentToBps,
  bpsToPercent,
  bpsTotal,
  validateRecipients,
  computeShares,
  parseOnchainError,
  shortAddr,
  type Recipient,
} from '@/utils/splitPayUtils'

// ── Test addresses ──────────────────────────────────────────────────────────
const ALICE = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const BOB   = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const CAROL = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const ZERO  = '0x0000000000000000000000000000000000000000'

function rec(address: string, percent: string): Recipient {
  return { address, percent }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. percentToBps
// ═══════════════════════════════════════════════════════════════════════════════
describe('percentToBps', () => {
  it('converts 50% to 5000 bps', () => expect(percentToBps('50')).toBe(5000))
  it('converts 33.33% to 3333 bps', () => expect(percentToBps('33.33')).toBe(3333))
  it('converts 33.34% to 3334 bps', () => expect(percentToBps('33.34')).toBe(3334))
  it('converts 100% to 10000 bps', () => expect(percentToBps('100')).toBe(10000))
  it('converts 0.01% to 1 bps', () => expect(percentToBps('0.01')).toBe(1))
  it('converts 99.99% to 9999 bps', () => expect(percentToBps('99.99')).toBe(9999))
  it('converts 16.67% to 1667 bps', () => expect(percentToBps('16.67')).toBe(1667))
  it('returns 0 for empty string', () => expect(percentToBps('')).toBe(0))
  it('returns 0 for non-numeric string', () => expect(percentToBps('abc')).toBe(0))

  it('33.33 + 33.33 + 33.34 bps sum to exactly 10000', () => {
    const sum = percentToBps('33.33') + percentToBps('33.33') + percentToBps('33.34')
    expect(sum).toBe(10000)
  })

  it('50 + 50 bps sum to exactly 10000', () => {
    expect(percentToBps('50') + percentToBps('50')).toBe(10000)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 2. bpsToPercent
// ═══════════════════════════════════════════════════════════════════════════════
describe('bpsToPercent', () => {
  it('3333 → "33.33"', () => expect(bpsToPercent(3333)).toBe('33.33'))
  it('5000 → "50.00"', () => expect(bpsToPercent(5000)).toBe('50.00'))
  it('10000 → "100.00"', () => expect(bpsToPercent(10000)).toBe('100.00'))
  it('1 → "0.01"', () => expect(bpsToPercent(1)).toBe('0.01'))
})

// ═══════════════════════════════════════════════════════════════════════════════
// 3. bpsTotal
// ═══════════════════════════════════════════════════════════════════════════════
describe('bpsTotal', () => {
  it('two equal recipients sum to 10000', () => {
    expect(bpsTotal([rec(ALICE, '50'), rec(BOB, '50')])).toBe(10000)
  })
  it('three recipients 33.33/33.33/33.34 sum to 10000', () => {
    expect(bpsTotal([rec(ALICE,'33.33'), rec(BOB,'33.33'), rec(CAROL,'33.34')])).toBe(10000)
  })
  it('under 100% detected', () => {
    expect(bpsTotal([rec(ALICE, '40'), rec(BOB, '40')])).toBe(8000)
  })
  it('over 100% detected', () => {
    expect(bpsTotal([rec(ALICE, '60'), rec(BOB, '60')])).toBe(12000)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 4. validateRecipients — address errors
// ═══════════════════════════════════════════════════════════════════════════════
describe('validateRecipients — address errors', () => {
  it('rejects empty address', () => {
    const { errors } = validateRecipients([rec('', '50'), rec(BOB, '50')], '10')
    expect(errors['addr_0']).toBeTruthy()
  })

  it('rejects non-hex string as address', () => {
    const { errors } = validateRecipients([rec('not-an-address', '50'), rec(BOB, '50')], '10')
    expect(errors['addr_0']).toMatch(/valid/i)
  })

  it('rejects zero address with a clear error message', () => {
    const { errors } = validateRecipients([rec(ZERO, '50'), rec(BOB, '50')], '10')
    expect(errors['addr_0']).toMatch(/zero/i)
  })

  it('rejects duplicate addresses (same checksummed address)', () => {
    const { errors } = validateRecipients([rec(ALICE, '50'), rec(ALICE, '50')], '10')
    expect(errors['addr_1']).toMatch(/duplicate/i)
  })

  it('rejects duplicate addresses case-insensitively', () => {
    const aliceLower = ALICE.toLowerCase() as `0x${string}`
    const { errors } = validateRecipients([rec(ALICE, '50'), rec(aliceLower, '50')], '10')
    expect(errors['addr_1']).toMatch(/duplicate/i)
  })

  it('accepts valid distinct addresses', () => {
    const { errors, ok } = validateRecipients([rec(ALICE, '50'), rec(BOB, '50')], '10')
    expect(errors['addr_0']).toBeUndefined()
    expect(errors['addr_1']).toBeUndefined()
    expect(ok).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 5. validateRecipients — percentage errors
// ═══════════════════════════════════════════════════════════════════════════════
describe('validateRecipients — percentage errors', () => {
  it('rejects total below 100%', () => {
    const { errors } = validateRecipients([rec(ALICE, '40'), rec(BOB, '40')], '10')
    expect(errors.bpsTotal).toMatch(/100/)
  })

  it('rejects total above 100%', () => {
    const { errors } = validateRecipients([rec(ALICE, '60'), rec(BOB, '60')], '10')
    expect(errors.bpsTotal).toMatch(/100/)
  })

  it('accepts total exactly 100%', () => {
    const { errors } = validateRecipients([rec(ALICE, '50'), rec(BOB, '50')], '10')
    expect(errors.bpsTotal).toBeUndefined()
  })

  it('rejects zero percent for a recipient', () => {
    const { errors } = validateRecipients([rec(ALICE, '0'), rec(BOB, '100')], '10')
    expect(errors['pct_0']).toBeTruthy()
  })

  it('rejects non-numeric percent', () => {
    const { errors } = validateRecipients([rec(ALICE, 'xyz'), rec(BOB, '100')], '10')
    expect(errors['pct_0']).toBeTruthy()
  })

  it('accepts three recipients summing to exactly 100%', () => {
    const { ok } = validateRecipients([
      rec(ALICE, '33.33'),
      rec(BOB, '33.33'),
      rec(CAROL, '33.34'),
    ], '10')
    expect(ok).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 6. validateRecipients — recipient count
// ═══════════════════════════════════════════════════════════════════════════════
describe('validateRecipients — count', () => {
  it('rejects 1 recipient', () => {
    const { errors } = validateRecipients([rec(ALICE, '100')], '10')
    expect(errors.recipientCount).toBeTruthy()
  })

  it('rejects 4 recipients', () => {
    const DAVE = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
    const { errors } = validateRecipients([
      rec(ALICE, '25'), rec(BOB, '25'), rec(CAROL, '25'), rec(DAVE, '25'),
    ], '10')
    expect(errors.recipientCount).toBeTruthy()
  })

  it('accepts 2 recipients', () => {
    const { errors } = validateRecipients([rec(ALICE, '50'), rec(BOB, '50')], '10')
    expect(errors.recipientCount).toBeUndefined()
  })

  it('accepts 3 recipients', () => {
    const { errors } = validateRecipients([
      rec(ALICE, '33.33'), rec(BOB, '33.33'), rec(CAROL, '33.34'),
    ], '10')
    expect(errors.recipientCount).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 7. validateRecipients — amount
// ═══════════════════════════════════════════════════════════════════════════════
describe('validateRecipients — amount', () => {
  it('rejects empty amount', () => {
    const { errors } = validateRecipients([rec(ALICE, '50'), rec(BOB, '50')], '')
    expect(errors.amount).toBeTruthy()
  })

  it('rejects zero amount', () => {
    const { errors } = validateRecipients([rec(ALICE, '50'), rec(BOB, '50')], '0')
    expect(errors.amount).toBeTruthy()
  })

  it('rejects non-numeric amount', () => {
    const { errors } = validateRecipients([rec(ALICE, '50'), rec(BOB, '50')], 'abc')
    expect(errors.amount).toBeTruthy()
  })

  it('accepts positive amount', () => {
    const { errors } = validateRecipients([rec(ALICE, '50'), rec(BOB, '50')], '10.5')
    expect(errors.amount).toBeUndefined()
  })

  it('accepts very small amount (0.000001 USDC = 1 micro)', () => {
    const { errors } = validateRecipients([rec(ALICE, '50'), rec(BOB, '50')], '0.000001')
    expect(errors.amount).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 8. computeShares — mirrors Solidity integer arithmetic exactly
// ═══════════════════════════════════════════════════════════════════════════════
describe('computeShares — Solidity integer arithmetic parity', () => {
  it('equal 2-way split: 10 USDC → 5 each', () => {
    const shares = computeShares([rec(ALICE, '50'), rec(BOB, '50')], 10_000_000n)
    expect(shares[0].rawAmount).toBe(5_000_000n)
    expect(shares[1].rawAmount).toBe(5_000_000n)
    expect(shares[0].rawAmount + shares[1].rawAmount).toBe(10_000_000n)
  })

  it('3-way 30/30/40 split: 100 USDC', () => {
    const shares = computeShares(
      [rec(ALICE, '30'), rec(BOB, '30'), rec(CAROL, '40')],
      100_000_000n
    )
    expect(shares[0].rawAmount).toBe(30_000_000n)
    expect(shares[1].rawAmount).toBe(30_000_000n)
    expect(shares[2].rawAmount).toBe(40_000_000n)
  })

  it('dust case: amount=3, bps=[3334,3333,3333] — last absorbs remainder', () => {
    const shares = computeShares(
      [rec(ALICE, '33.34'), rec(BOB, '33.33'), rec(CAROL, '33.33')],
      3n
    )
    // floor(3*3334/10000)=1, floor(3*3333/10000)=0, last=3-1-0=2
    expect(shares[0].rawAmount).toBe(1n)
    expect(shares[1].rawAmount).toBe(0n)
    expect(shares[2].rawAmount).toBe(2n)
    const total = shares.reduce((a, b) => a + b.rawAmount, 0n)
    expect(total).toBe(3n)
  })

  it('extreme dust: amount=1, bps=[5000,5000] — first gets 0, last gets 1', () => {
    const shares = computeShares([rec(ALICE, '50'), rec(BOB, '50')], 1n)
    expect(shares[0].rawAmount).toBe(0n)
    expect(shares[1].rawAmount).toBe(1n)
  })

  it('conservation: sum of shares always equals amount', () => {
    const cases: [bigint, string[]][] = [
      [100_000_000n, ['33.33', '33.33', '33.34']],
      [999_999_000_000n, ['33.33', '33.33', '33.34']],
      [7n, ['33.33', '33.33', '33.34']],
      [1_000_000n, ['50', '50']],
      [123_456_789n, ['12.50', '37.50', '50']],
    ]
    for (const [amount, percents] of cases) {
      const recipients = [
        rec(ALICE, percents[0]),
        rec(BOB, percents[1]),
        ...(percents[2] ? [rec(CAROL, percents[2])] : []),
      ]
      const shares = computeShares(recipients, amount)
      const total = shares.reduce((a, b) => a + b.rawAmount, 0n)
      expect(total).toBe(amount)
    }
  })

  it('bps values on shares match inputs', () => {
    const shares = computeShares([rec(ALICE, '33.33'), rec(BOB, '33.33'), rec(CAROL, '33.34')], 100_000_000n)
    expect(shares[0].bps).toBe(3333)
    expect(shares[1].bps).toBe(3333)
    expect(shares[2].bps).toBe(3334)
  })

  it('display strings are non-empty for all shares', () => {
    const shares = computeShares([rec(ALICE, '50'), rec(BOB, '50')], 10_000_000n)
    for (const s of shares) {
      expect(typeof s.display).toBe('string')
      expect(s.display.length).toBeGreaterThan(0)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 9. parseOnchainError — covers all contract custom errors + wagmi errors
// ═══════════════════════════════════════════════════════════════════════════════
describe('parseOnchainError', () => {
  it('user rejected → "Transaction cancelled."', () => {
    expect(parseOnchainError({ message: 'User rejected the request.' })).toBe('Transaction cancelled.')
    expect(parseOnchainError({ message: 'MetaMask: User denied transaction' })).toBe('Transaction cancelled.')
    expect(parseOnchainError({ message: 'Error 4001: rejected' })).toBe('Transaction cancelled.')
  })

  it('insufficient allowance → readable message', () => {
    expect(parseOnchainError({ message: 'Insufficient allowance' })).toMatch(/allowance/i)
  })

  it('insufficient balance → readable message', () => {
    expect(parseOnchainError({ message: 'Insufficient USDC balance' })).toMatch(/balance/i)
  })

  it('DuplicateRecipient revert → readable message', () => {
    expect(parseOnchainError({ shortMessage: 'DuplicateRecipient()' })).toMatch(/duplicate/i)
  })

  it('InvalidBps revert → readable message', () => {
    expect(parseOnchainError({ shortMessage: 'InvalidBps()' })).toMatch(/100/i)
  })

  it('InvalidRecipientCount revert → readable message', () => {
    expect(parseOnchainError({ shortMessage: 'InvalidRecipientCount()' })).toMatch(/2 or 3/i)
  })

  it('ZeroAddress revert → readable message', () => {
    expect(parseOnchainError({ shortMessage: 'ZeroAddress()' })).toMatch(/zero/i)
  })

  it('ZeroAmount revert → readable message', () => {
    expect(parseOnchainError({ shortMessage: 'ZeroAmount()' })).toMatch(/greater than 0/i)
  })

  it('TransferFailed revert → readable message', () => {
    expect(parseOnchainError({ shortMessage: 'TransferFailed()' })).toMatch(/transfer failed/i)
  })

  it('generic revert → "Transaction reverted."', () => {
    expect(parseOnchainError({ message: 'execution reverted' })).toMatch(/reverted/i)
  })

  it('network error → readable message', () => {
    expect(parseOnchainError({ message: 'network timeout' })).toMatch(/network error/i)
  })

  it('null/undefined → "Unknown error."', () => {
    expect(parseOnchainError(null)).toBe('Unknown error.')
    expect(parseOnchainError(undefined)).toBe('Unknown error.')
  })

  it('string error → returned as-is or trimmed', () => {
    const long = 'a'.repeat(200)
    const result = parseOnchainError({ message: long })
    expect(result.length).toBeLessThanOrEqual(121)
  })

  it('shortMessage takes priority over message', () => {
    const err = { shortMessage: 'DuplicateRecipient()', message: 'execution reverted' }
    expect(parseOnchainError(err)).toMatch(/duplicate/i)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 10. shortAddr
// ═══════════════════════════════════════════════════════════════════════════════
describe('shortAddr', () => {
  it('abbreviates a full address', () => {
    expect(shortAddr(ALICE)).toBe('0xf39F…2266')
  })
  it('returns short strings unchanged', () => {
    expect(shortAddr('0x123')).toBe('0x123')
  })
  it('handles empty string', () => {
    expect(shortAddr('')).toBe('')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Zero address rejection gap test (structural)
// ═══════════════════════════════════════════════════════════════════════════════
describe('zero address frontend gap', () => {
  it('zero address is now rejected by the frontend validator', () => {
    const { errors } = validateRecipients([rec(ZERO, '50'), rec(BOB, '50')], '10')
    expect(errors['addr_0']).toMatch(/zero/i)
  })
})
