import { CheckCircle, XCircle, Loader2, ExternalLink } from 'lucide-react'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { ARC_MAINNET_ID } from '@/config'

export type TxStep = 'idle' | 'approving' | 'approved' | 'splitting' | 'success' | 'error'

interface Props {
  step: TxStep
  approveHash?: `0x${string}`
  splitHash?: `0x${string}`
  errorMessage?: string
  onReset: () => void
}

export function TxStatus({ step, approveHash, splitHash, errorMessage, onReset }: Props) {
  if (step === 'idle') return null

  const explorerUrl = (hash: `0x${string}`) => buildTxExplorerUrl(ARC_MAINNET_ID, hash)

  return (
    <div
      className="rounded-2xl p-4 space-y-3"
      style={{
        background:
          step === 'success'
            ? 'rgba(26,128,71,0.07)'
            : step === 'error'
              ? 'rgba(186,43,76,0.07)'
              : 'var(--surface-muted)',
        border:
          step === 'success'
            ? '1.5px solid rgba(26,128,71,0.25)'
            : step === 'error'
              ? '1.5px solid rgba(186,43,76,0.25)'
              : '1.5px solid var(--border)',
      }}
    >
      {/* Step: approving */}
      {(step === 'approving' || step === 'approved' || step === 'splitting' || step === 'success') && (
        <TxRow
          label="1. Approve"
          done={step !== 'approving'}
          pending={step === 'approving'}
          hash={approveHash}
          explorerUrl={approveHash ? explorerUrl(approveHash) : undefined}
        />
      )}

      {/* Step: splitting */}
      {(step === 'splitting' || step === 'success') && (
        <TxRow
          label="2. Split payment"
          done={step === 'success'}
          pending={step === 'splitting'}
          hash={splitHash}
          explorerUrl={splitHash ? explorerUrl(splitHash) : undefined}
        />
      )}

      {/* Success */}
      {step === 'success' && (
        <div className="flex items-center gap-2 pt-1">
          <CheckCircle className="size-4 shrink-0" style={{ color: 'var(--success)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--success)' }}>
            Payment split successfully.
          </span>
        </div>
      )}

      {/* Error */}
      {step === 'error' && (
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <XCircle className="size-4 mt-0.5 shrink-0" style={{ color: 'var(--danger)' }} />
            <p className="text-sm" style={{ color: 'var(--danger)' }}>
              {errorMessage ?? 'Transaction failed.'}
            </p>
          </div>
          {approveHash && (
            <TxRow
              label="Approval"
              done
              pending={false}
              hash={approveHash}
              explorerUrl={explorerUrl(approveHash)}
            />
          )}
        </div>
      )}

      {/* Reset button for terminal states */}
      {(step === 'success' || step === 'error') && (
        <button
          onClick={onReset}
          className="w-full rounded-xl py-2.5 text-sm font-semibold transition-all hover:opacity-80"
          style={{ background: 'var(--surface)', border: '1.5px solid var(--border)', color: 'var(--ink-2)' }}
        >
          {step === 'success' ? 'Send another split' : 'Try again'}
        </button>
      )}
    </div>
  )
}

// ─── TxRow helper ─────────────────────────────────────────────────────────────

interface TxRowProps {
  label: string
  done: boolean
  pending: boolean
  hash?: `0x${string}`
  explorerUrl?: string
}

function TxRow({ label, done, pending, hash, explorerUrl }: TxRowProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {pending ? (
          <Loader2 className="size-4 animate-spin shrink-0" style={{ color: 'var(--accent)' }} />
        ) : done ? (
          <CheckCircle className="size-4 shrink-0" style={{ color: 'var(--success)' }} />
        ) : (
          <div className="size-4 rounded-full shrink-0" style={{ border: '2px solid var(--border)' }} />
        )}
        <span className="text-sm" style={{ color: pending ? 'var(--ink)' : done ? 'var(--ink-2)' : 'var(--subtle)' }}>
          {pending ? `${label} — confirm in wallet…` : label}
        </span>
      </div>

      {hash && explorerUrl && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs shrink-0 hover:underline"
          style={{ color: 'var(--accent-hover)' }}
        >
          View <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  )
}
