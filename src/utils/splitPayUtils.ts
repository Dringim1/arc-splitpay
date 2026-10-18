/**
 * Validation, share arithmetic, and error parsing for the PaymentSplitter UI.
 * Pure functions — no React, no wagmi imports.
 */

import { isAddress } from 'viem'
import { parseUsdc, formatUsdc } from '@/onchain-money'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Recipient {
  address: string
  percent: string // user-visible string, e.g. "33.33"
}

export interface SharePreview {
  address: string
  bps: number       // 0–10000, integer
  rawAmount: bigint // USDC 6-decimal integer
  display: string   // "1.23"
}

// ─── BPS ─────────────────────────────────────────────────────────────────────

/** Converts a user percent string ("33.33") to integer basis points (3333). */
export function percentToBps(percent: string): number {
  // Round to nearest integer bp after multiplying by 100
  const n = parseFloat(percent)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
}

/** Converts integer basis points (3333) to a display percent string ("33.33"). */
export function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2)
}

/** Sum of all recipient bps values. */
export function bpsTotal(recipients: Recipient[]): number {
  return recipients.reduce((sum, r) => sum + percentToBps(r.percent), 0)
}

// ─── Validation ──────────────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean
  errors: Record<string, string> // field key → error message
}

export function validateRecipients(recipients: Recipient[], amount: string): ValidationResult {
  const errors: Record<string, string> = {}

  // At least 2, at most 3
  if (recipients.length < 2 || recipients.length > 3) {
    errors.recipientCount = 'You need 2 or 3 recipients.'
  }

  // Address validity + uniqueness
  const seen = new Set<string>()
  recipients.forEach((r, i) => {
    if (!r.address.trim()) {
      errors[`addr_${i}`] = 'Address is required.'
    } else if (!isAddress(r.address.trim())) {
      errors[`addr_${i}`] = 'Not a valid EVM address.'
    } else if (BigInt(r.address.trim()) === 0n) {
      errors[`addr_${i}`] = 'Recipient address cannot be the zero address.'
    } else {
      const lower = r.address.trim().toLowerCase()
      if (seen.has(lower)) {
        errors[`addr_${i}`] = 'Duplicate recipient address.'
      }
      seen.add(lower)
    }
  })

  // Percent validity per recipient
  recipients.forEach((r, i) => {
    const bps = percentToBps(r.percent)
    if (!r.percent.trim() || !Number.isFinite(parseFloat(r.percent))) {
      errors[`pct_${i}`] = 'Enter a valid percentage.'
    } else if (bps <= 0) {
      errors[`pct_${i}`] = 'Each share must be > 0%.'
    } else if (bps > 9999) {
      errors[`pct_${i}`] = 'Each share must be < 100%.'
    }
  })

  // Total must be exactly 10,000 bps (100%)
  const total = bpsTotal(recipients)
  if (total !== 10_000) {
    errors.bpsTotal = `Total is ${(total / 100).toFixed(2)}% — must be exactly 100%.`
  }

  // Amount
  if (!amount.trim()) {
    errors.amount = 'Enter an amount.'
  } else {
    try {
      const raw = parseUsdc(amount.trim())
      if (raw <= 0n) errors.amount = 'Amount must be greater than 0.'
    } catch {
      errors.amount = 'Invalid amount — use up to 6 decimal places.'
    }
  }

  return { ok: Object.keys(errors).length === 0, errors }
}

// ─── Share preview ────────────────────────────────────────────────────────────

/**
 * Computes the exact shares each recipient will receive, matching the contract's
 * integer arithmetic: floor(amount * bps[i] / 10_000) for all but last;
 * last = amount - sum(others).
 */
export function computeShares(recipients: Recipient[], amountRaw: bigint): SharePreview[] {
  const len = recipients.length
  const bpsValues = recipients.map((r) => percentToBps(r.percent))
  const previews: SharePreview[] = []
  let distributed = 0n

  for (let i = 0; i < len - 1; i++) {
    const raw = (amountRaw * BigInt(bpsValues[i])) / 10_000n
    previews.push({
      address: recipients[i].address,
      bps: bpsValues[i],
      rawAmount: raw,
      display: formatUsdc(raw),
    })
    distributed += raw
  }

  // Last recipient absorbs dust, exactly as the contract does
  const lastRaw = amountRaw - distributed
  previews.push({
    address: recipients[len - 1].address,
    bps: bpsValues[len - 1],
    rawAmount: lastRaw,
    display: formatUsdc(lastRaw),
  })

  return previews
}

// ─── Error parsing ────────────────────────────────────────────────────────────

/** Extracts a human-readable message from a wagmi/viem error or an unknown value. */
export function parseOnchainError(error: unknown): string {
  if (!error) return 'Unknown error.'

  const shortMsg: string | undefined =
    (error as { shortMessage?: string }).shortMessage ??
    (error as { message?: string }).message
  const msg: string =
    shortMsg ??
    (typeof error === 'object' && error !== null
      ? JSON.stringify(error)
      : `${error as string}`)

  const lower = msg.toLowerCase()

  if (lower.includes('user rejected') || lower.includes('user denied') || lower.includes('4001')) {
    return 'Transaction cancelled.'
  }
  if (lower.includes('insufficient') && lower.includes('allowance')) {
    return 'Allowance too low — approve first.'
  }
  if (lower.includes('insufficient')) {
    return 'Insufficient USDC balance.'
  }
  if (lower.includes('duplicaterecipient')) return 'Duplicate recipient address.'
  if (lower.includes('invalidbps')) return 'Percentages must total exactly 100%.'
  if (lower.includes('invalidrecipientcount')) return '2 or 3 recipients required.'
  if (lower.includes('zeroaddress')) return 'Recipient address cannot be zero.'
  if (lower.includes('zeroamount')) return 'Amount must be greater than 0.'
  if (lower.includes('transferfailed')) return 'Transfer failed — check balances and approval.'
  if (lower.includes('reverted')) {
    const reason = msg.match(/reason[:\s]+"?([^"]+)"?/i)?.[1]
    return reason ? `Transaction reverted: ${reason}` : 'Transaction reverted.'
  }
  if (lower.includes('network') || lower.includes('timeout') || lower.includes('rpc')) {
    return 'Network error — check your connection and try again.'
  }

  // Trim to something displayable
  return msg.length > 120 ? msg.slice(0, 117) + '…' : msg
}

// ─── Address formatting ───────────────────────────────────────────────────────

export function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}
