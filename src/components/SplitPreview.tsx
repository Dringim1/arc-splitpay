import { ArrowRight } from 'lucide-react'
import type { SharePreview } from '@/utils/splitPayUtils'
import { shortAddr } from '@/utils/splitPayUtils'

interface Props {
  shares: SharePreview[]
  totalDisplay: string
}

export function SplitPreview({ shares, totalDisplay }: Props) {
  return (
    <div
      className="rounded-2xl p-4 space-y-3"
      style={{ background: 'var(--surface-muted)', border: '1.5px solid var(--border)' }}
    >
      <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--subtle)' }}>
        Split preview
      </p>

      <div className="space-y-2">
        {shares.map((s, i) => (
          <div key={i} className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <ArrowRight className="size-3 shrink-0" style={{ color: 'var(--subtle)' }} />
              <span
                className="mono text-xs truncate"
                style={{ color: 'var(--ink-2)' }}
                title={s.address}
              >
                {shortAddr(s.address)}
              </span>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                {(s.bps / 100).toFixed(2)}%
              </span>
            </div>
            <span
              className="display text-sm font-bold tabular-nums shrink-0 ml-3"
              style={{ color: 'var(--ink)' }}
            >
              {s.display} <span style={{ color: 'var(--subtle)' }}>USDC</span>
            </span>
          </div>
        ))}
      </div>

      <div
        className="flex items-center justify-between pt-2"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Total</span>
        <span className="display text-sm font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
          {totalDisplay} <span style={{ color: 'var(--subtle)' }}>USDC</span>
        </span>
      </div>

      <p className="text-xs" style={{ color: 'var(--subtle)' }}>
        Rounding dust (if any) goes to the last recipient.
      </p>
    </div>
  )
}
