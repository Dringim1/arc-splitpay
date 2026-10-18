import { useState, useCallback, useMemo } from 'react'
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
  usePublicClient,
} from 'wagmi'
import { erc20Abi } from 'viem'
import { ConnectKitButton } from 'connectkit'
import { AlertTriangle, ArrowRightLeft, Coins, ShieldCheck } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'

import { ARC_MAINNET_ID } from '@/config'
import { getUsdc } from '@/onchain-facts'
import { Amount, parseUsdc, formatUsdc } from '@/onchain-money'
import { PAYMENT_SPLITTER_ABI, PAYMENT_SPLITTER_ADDRESS } from '@/contract'
import { RecipientRow } from '@/components/RecipientRow'
import { SplitPreview } from '@/components/SplitPreview'
import { TxStatus } from '@/components/TxStatus'
import type { TxStep } from '@/components/TxStatus'
import type { Recipient } from '@/utils/splitPayUtils'
import {
  validateRecipients,
  computeShares,
  parseOnchainError,
  bpsTotal,
  percentToBps,
  shortAddr,
} from '@/utils/splitPayUtils'

// ─── Constants ────────────────────────────────────────────────────────────────

const usdc = getUsdc(ARC_MAINNET_ID)
const USDC_ADDRESS = usdc?.address as `0x${string}` | undefined

const DEFAULT_RECIPIENTS: Recipient[] = [
  { address: '', percent: '50' },
  { address: '', percent: '50' },
]

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const { address: walletAddress, chainId, isConnected } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const publicClient = usePublicClient({ chainId: ARC_MAINNET_ID })

  // Form state
  const [recipients, setRecipients] = useState<Recipient[]>(DEFAULT_RECIPIENTS)
  const [amount, setAmount] = useState('')
  const [formTouched, setFormTouched] = useState(false)
  // Per-field touched state: show inline errors on blur, not only on submit
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set())

  // Transaction state
  const [step, setStep] = useState<TxStep>('idle')
  const [approveHash, setApproveHash] = useState<`0x${string}` | undefined>()
  const [splitHash, setSplitHash] = useState<`0x${string}` | undefined>()
  const [txError, setTxError] = useState<string | undefined>()

  const isOnCorrectChain = chainId === ARC_MAINNET_ID
  const contractReady = PAYMENT_SPLITTER_ADDRESS !== null
  const txPending = step === 'approving' || step === 'splitting'

  // ─── Live USDC balance ──────────────────────────────────────────────────────
  const { data: rawBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: walletAddress ? [walletAddress] : undefined,
    chainId: ARC_MAINNET_ID,
    query: { enabled: !!walletAddress && !!USDC_ADDRESS },
  })

  const formattedBalance = rawBalance !== undefined
    ? Amount.fromRaw(rawBalance, 6).toFixed(2)
    : undefined

  // ─── Live allowance ─────────────────────────────────────────────────────────
  const { data: rawAllowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args:
      walletAddress && PAYMENT_SPLITTER_ADDRESS
        ? [walletAddress, PAYMENT_SPLITTER_ADDRESS]
        : undefined,
    chainId: ARC_MAINNET_ID,
    query: { enabled: !!walletAddress && !!USDC_ADDRESS && !!PAYMENT_SPLITTER_ADDRESS },
  })

  // ─── Parsed amount + validation ─────────────────────────────────────────────
  const amountRaw = useMemo(() => {
    try { return parseUsdc(amount.trim()) } catch { return 0n }
  }, [amount])

  const validation = useMemo(
    () => (formTouched ? validateRecipients(recipients, amount) : { ok: false, errors: {} }),
    [recipients, amount, formTouched],
  )

  const shares = useMemo(() => {
    if (amountRaw > 0n) {
      try { return computeShares(recipients, amountRaw) } catch { return [] }
    }
    return []
  }, [recipients, amountRaw])

  const totalBps = useMemo(() => bpsTotal(recipients), [recipients])
  const bpsRemaining = 10_000 - totalBps
  const bpsDisplay = (bpsRemaining / 100).toFixed(2)
  const needsApproval = rawAllowance !== undefined && amountRaw > 0n && rawAllowance < amountRaw

  // ─── Wagmi write hooks ──────────────────────────────────────────────────────
  const {
    writeContractAsync: writeApprove,
    isPending: isApprovePending,
  } = useWriteContract()

  const {
    writeContractAsync: writeSplit,
    isPending: isSplitPending,
  } = useWriteContract()

  // Wait for approve tx confirmation
  const { isLoading: isApproveConfirming } = useWaitForTransactionReceipt({
    hash: approveHash,
    chainId: ARC_MAINNET_ID,
    query: { enabled: !!approveHash && step === 'approving' },
  })

  // Wait for split tx confirmation
  const { isLoading: isSplitConfirming } = useWaitForTransactionReceipt({
    hash: splitHash,
    chainId: ARC_MAINNET_ID,
    query: { enabled: !!splitHash && step === 'splitting' },
  })

  // ─── Recipient mutation helpers ─────────────────────────────────────────────
  const handleRecipientChange = useCallback(
    (index: number, field: 'address' | 'percent', value: string) => {
      setRecipients((prev) => {
        const next = [...prev]
        next[index] = { ...next[index], [field]: value }
        return next
      })
    },
    [],
  )

  const handleRecipientBlur = useCallback(
    (index: number, field: 'address' | 'percent') => {
      setTouchedFields((prev) => new Set([...prev, `${field}_${index}`]))
    },
    [],
  )

  const handleRemoveRecipient = useCallback((index: number) => {
    setRecipients((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleAddRecipient = useCallback(() => {
    setRecipients((prev) => [...prev, { address: '', percent: '' }])
  }, [])

  // ─── Max button ─────────────────────────────────────────────────────────────
  const handleMax = useCallback(() => {
    if (rawBalance !== undefined) {
      setAmount(formatUsdc(rawBalance))
    }
  }, [rawBalance])

  // ─── Main submit: approve + split ───────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    setFormTouched(true)
    const result = validateRecipients(recipients, amount)
    if (!result.ok) return
    if (!PAYMENT_SPLITTER_ADDRESS || !USDC_ADDRESS) return

    const recipientAddrs = recipients.map((r) => r.address.trim() as `0x${string}`)
    const bpsValues = recipients.map((r) => percentToBps(r.percent))

    setTxError(undefined)
    setApproveHash(undefined)
    setSplitHash(undefined)

    try {
      if (!publicClient) throw new Error('Public client not available — check network.')

      // Step 1: Approve if needed.
      // Check undefined explicitly: rawAllowance === 0n is falsy in JS but means
      // "zero allowance" (needs approval), while undefined means "not yet loaded".
      // Both require approval, but the explicit check makes intent clear.
      if (rawAllowance === undefined || rawAllowance < amountRaw) {
        setStep('approving')
        const hash = await writeApprove({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: 'approve',
          args: [PAYMENT_SPLITTER_ADDRESS, amountRaw],
          chainId: ARC_MAINNET_ID,
        })
        setApproveHash(hash)

        // Wait for on-chain confirmation before proceeding to split.
        // 5-minute timeout: if the tx is dropped the catch block sets step('error').
        await publicClient.waitForTransactionReceipt({ hash, timeout: 300_000 })
        await refetchAllowance()
        setStep('approved')
      }

      // Step 2: Split
      setStep('splitting')
      const splitTxHash = await writeSplit({
        address: PAYMENT_SPLITTER_ADDRESS,
        abi: PAYMENT_SPLITTER_ABI,
        functionName: 'splitPayment',
        args: [recipientAddrs, bpsValues as readonly number[], amountRaw],
        chainId: ARC_MAINNET_ID,
      })
      setSplitHash(splitTxHash)

      // Wait for on-chain confirmation before reporting success.
      // 5-minute timeout: dropped txs surface as an error instead of hanging forever.
      await publicClient.waitForTransactionReceipt({ hash: splitTxHash, timeout: 300_000 })

      setStep('success')
    } catch (err) {
      setTxError(parseOnchainError(err))
      setStep('error')
    }
  }, [
    recipients,
    amount,
    amountRaw,
    rawAllowance,
    writeApprove,
    writeSplit,
    refetchAllowance,
    publicClient,
  ])

  const handleReset = useCallback(() => {
    setStep('idle')
    setApproveHash(undefined)
    setSplitHash(undefined)
    setTxError(undefined)
    setFormTouched(false)
    setTouchedFields(new Set())
    if (step === 'success') {
      setRecipients(DEFAULT_RECIPIENTS)
      setAmount('')
    }
  }, [step])

  // ─── CTA label ──────────────────────────────────────────────────────────────
  const ctaLabel = useMemo(() => {
    if (!isConnected) return 'Connect wallet'
    if (!isOnCorrectChain) return 'Switch to Arc Mainnet'
    if (isSwitching) return 'Switching…'
    if (!contractReady) return 'Contract not deployed'
    if (step === 'approving' || isApprovePending || isApproveConfirming)
      return 'Approving…'
    if (step === 'splitting' || isSplitPending || isSplitConfirming)
      return 'Sending…'
    if (needsApproval) return 'Approve & split'
    return 'Send split payment'
  }, [
    isConnected,
    isOnCorrectChain,
    isSwitching,
    contractReady,
    step,
    isApprovePending,
    isApproveConfirming,
    isSplitPending,
    isSplitConfirming,
    needsApproval,
  ])

  const ctaDisabled =
    !isConnected ||
    isSwitching ||
    !contractReady ||
    txPending ||
    step === 'success'

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-dvh"
      style={{ background: 'var(--bg-gradient)' }}
    >
      <div className="mx-auto max-w-md px-4 py-8 pb-24 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="flex size-8 items-center justify-center rounded-xl"
              style={{ background: 'var(--accent)' }}
            >
              <ArrowRightLeft className="size-4 text-white" />
            </div>
            <div>
              <h1 className="display text-lg font-bold leading-tight" style={{ color: 'var(--ink)' }}>
                SplitPay
              </h1>
              <p className="text-xs" style={{ color: 'var(--subtle)' }}>Arc Mainnet · USDC</p>
            </div>
          </div>
          <ConnectKitButton />
        </div>

        {/* Not-deployed banner */}
        {!contractReady && (
          <div
            className="flex items-start gap-3 rounded-2xl p-4"
            style={{ background: 'rgba(186,43,76,0.07)', border: '1.5px solid rgba(186,43,76,0.25)' }}
          >
            <AlertTriangle className="size-4 mt-0.5 shrink-0" style={{ color: 'var(--danger)' }} />
            <div className="space-y-1">
              <p className="text-sm font-semibold" style={{ color: 'var(--danger)' }}>
                Contract not deployed
              </p>
              <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
                Set <code className="mono text-xs">PAYMENT_SPLITTER_ADDRESS</code> in{' '}
                <code className="mono text-xs">src/contract.ts</code> after deploying and
                verifying the contract on Arc Mainnet. Transactions are disabled until then.
              </p>
            </div>
          </div>
        )}

        {/* Wrong-chain banner */}
        {isConnected && !isOnCorrectChain && (
          <div
            className="flex items-center gap-3 rounded-2xl p-4"
            style={{ background: 'rgba(186,43,76,0.07)', border: '1.5px solid rgba(186,43,76,0.25)' }}
          >
            <AlertTriangle className="size-4 shrink-0" style={{ color: 'var(--danger)' }} />
            <p className="text-sm flex-1" style={{ color: 'var(--danger)' }}>
              Switch your wallet to Arc Mainnet (chain ID 5042).
            </p>
            <button
              onClick={() => switchChain({ chainId: ARC_MAINNET_ID })}
              disabled={isSwitching}
              className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              style={{ background: 'var(--danger)' }}
            >
              {isSwitching ? 'Switching…' : 'Switch'}
            </button>
          </div>
        )}

        {/* Balance card */}
        {isConnected && isOnCorrectChain && (
          <div
            className="rounded-3xl p-5"
            style={{
              background: 'var(--surface)',
              backdropFilter: 'blur(20px) saturate(180%)',
              border: '1.5px solid var(--border)',
            }}
          >
            <div className="flex items-center gap-1.5 mb-3">
              <div
                className="flex size-5 items-center justify-center rounded-md"
                style={{ background: 'rgba(26,128,71,0.12)' }}
              >
                <Coins className="size-3" style={{ color: 'var(--success)' }} />
              </div>
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
                Your USDC Balance
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <TokenUSDC variant="branded" size={20} />
              <span
                className="display text-4xl font-bold tabular-nums"
                style={{ color: 'var(--ink)' }}
              >
                {formattedBalance ?? '—'}
              </span>
              <span className="text-lg font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
            </div>
            <p className="mt-1.5 text-xs" style={{ color: 'var(--muted)' }}>
              {walletAddress ? shortAddr(walletAddress) : ''} · Arc Mainnet
            </p>
          </div>
        )}

        {/* Form card */}
        <div
          className="rounded-3xl p-5 space-y-5"
          style={{
            background: 'var(--surface)',
            backdropFilter: 'blur(20px) saturate(180%)',
            border: '1.5px solid var(--border)',
          }}
        >
          <h2 className="display text-base font-semibold" style={{ color: 'var(--ink)' }}>
            Split details
          </h2>

          {/* Recipients */}
          <div className="space-y-4">
            {recipients.map((r, i) => (
              <RecipientRow
                key={i}
                index={i}
                recipient={r}
                onChange={handleRecipientChange}
                onBlur={handleRecipientBlur}
                onRemove={handleRemoveRecipient}
                onAdd={handleAddRecipient}
                canRemove={recipients.length > 2}
                canAdd={i === recipients.length - 1 && recipients.length < 3}
                addrError={
                  (formTouched || touchedFields.has(`address_${i}`))
                    ? validation.errors[`addr_${i}`]
                    : undefined
                }
                pctError={
                  (formTouched || touchedFields.has(`percent_${i}`))
                    ? validation.errors[`pct_${i}`]
                    : undefined
                }
                disabled={txPending || step === 'success'}
              />
            ))}
          </div>

          {/* Bps total indicator */}
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: 'var(--muted)' }}>Total allocation</span>
            <span
              className="display text-sm font-bold tabular-nums"
              style={{ color: totalBps === 10_000 ? 'var(--success)' : bpsRemaining < 0 ? 'var(--danger)' : 'var(--ink)' }}
            >
              {(totalBps / 100).toFixed(2)}%
              {totalBps !== 10_000 && (
                <span className="text-xs font-normal ml-1" style={{ color: 'var(--muted)' }}>
                  ({bpsRemaining >= 0 ? `${bpsDisplay}% remaining` : `${Math.abs(bpsRemaining / 100).toFixed(2)}% over`})
                </span>
              )}
            </span>
          </div>
          {formTouched && validation.errors.bpsTotal && (
            <p className="text-xs" style={{ color: 'var(--danger)' }}>{validation.errors.bpsTotal}</p>
          )}

          {/* Amount input */}
          <div>
            <div
              className="rounded-2xl px-4 py-3"
              style={{
                background: 'var(--surface-muted)',
                border: formTouched && validation.errors.amount
                  ? '1.5px solid var(--danger)'
                  : '1.5px solid var(--border)',
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium" style={{ color: 'var(--subtle)' }}>Amount</span>
                <button
                  type="button"
                  onClick={handleMax}
                  disabled={!rawBalance || txPending}
                  className="text-xs font-semibold disabled:opacity-40"
                  style={{ color: 'var(--accent-hover)' }}
                >
                  {formattedBalance ? `Balance: ${formattedBalance} · Max` : 'Max'}
                </button>
              </div>
              <div className="flex items-baseline gap-1">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  aria-label="USDC amount"
                  value={amount}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9.]/g, '')
                    if ((v.match(/\./g) ?? []).length <= 1) setAmount(v)
                  }}
                  disabled={txPending || step === 'success'}
                  className="display w-full bg-transparent text-4xl font-bold tabular-nums outline-none placeholder:text-slate-300 disabled:opacity-50"
                  style={{ color: 'var(--ink)' }}
                />
                <span className="text-xl font-medium shrink-0" style={{ color: 'var(--subtle)' }}>USDC</span>
              </div>
            </div>
            {formTouched && validation.errors.amount && (
              <p className="text-xs mt-1 pl-1" style={{ color: 'var(--danger)' }}>{validation.errors.amount}</p>
            )}
          </div>

          {/* Split preview */}
          {shares.length > 0 && totalBps === 10_000 && amountRaw > 0n && (
            <SplitPreview shares={shares} totalDisplay={formatUsdc(amountRaw)} />
          )}

          {/* Approval notice */}
          {isConnected && isOnCorrectChain && needsApproval && step === 'idle' && (
            <div
              className="flex items-start gap-2 rounded-2xl p-3"
              style={{ background: 'rgba(18,45,69,0.06)', border: '1px solid var(--border)' }}
            >
              <ShieldCheck className="size-4 mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
              <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
                Two transactions required: first <strong>approve</strong> the splitter to spend{' '}
                {formatUsdc(amountRaw)} USDC, then <strong>split</strong> the payment. Both must
                be confirmed in your wallet.
              </p>
            </div>
          )}

          {/* Transaction status */}
          {step !== 'idle' && (
            <TxStatus
              step={step}
              approveHash={approveHash}
              splitHash={splitHash}
              errorMessage={txError}
              onReset={handleReset}
            />
          )}

          {/* CTA */}
          {step === 'idle' || step === 'error' ? (
            <button
              onClick={
                !isConnected
                  ? undefined
                  : !isOnCorrectChain
                    ? () => switchChain({ chainId: ARC_MAINNET_ID })
                    : handleSubmit
              }
              disabled={ctaDisabled}
              className="w-full rounded-2xl py-4 text-sm font-bold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: 'var(--accent)' }}
            >
              {ctaLabel}
            </button>
          ) : step !== 'success' ? (
            <button
              disabled
              className="w-full rounded-2xl py-4 text-sm font-bold text-white opacity-60 cursor-not-allowed flex items-center justify-center gap-2"
              style={{ background: 'var(--accent)' }}
            >
              <span className="inline-block size-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              {ctaLabel}
            </button>
          ) : null}
        </div>

        {/* Footer note */}
        <p className="text-center text-xs px-4" style={{ color: 'var(--subtle)' }}>
          Transactions are irreversible. Verify all addresses before sending.
          This app targets Arc Mainnet and uses real USDC.
        </p>
      </div>
    </div>
  )
}
