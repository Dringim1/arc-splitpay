import { Trash2, UserPlus } from 'lucide-react'
import type { Recipient } from '@/utils/splitPayUtils'

interface Props {
  index: number
  recipient: Recipient
  onChange: (index: number, field: 'address' | 'percent', value: string) => void
  onBlur: (index: number, field: 'address' | 'percent') => void
  onRemove: (index: number) => void
  onAdd: () => void
  canRemove: boolean
  canAdd: boolean
  addrError?: string
  pctError?: string
  disabled?: boolean
}

export function RecipientRow({
  index,
  recipient,
  onChange,
  onBlur,
  onRemove,
  onAdd,
  canRemove,
  canAdd,
  addrError,
  pctError,
  disabled,
}: Props) {
  const label = index === 0 ? 'First' : index === 1 ? 'Second' : 'Third'

  return (
    <div className="space-y-2">
      {/* Row label */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--subtle)' }}>
          {label} recipient
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={() => onRemove(index)}
            disabled={disabled}
            className="flex items-center gap-1 text-xs disabled:opacity-40"
            style={{ color: 'var(--danger)' }}
          >
            <Trash2 className="size-3" />
            Remove
          </button>
        )}
      </div>

      {/* Address input */}
      <div
        className="rounded-2xl px-4 py-3 transition-colors focus-within:ring-2"
        style={{
          background: 'var(--surface-muted)',
          border: addrError ? '1.5px solid var(--danger)' : '1.5px solid var(--border)',
        }}
      >
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--subtle)' }}>
          Wallet address
        </label>
        <input
          type="text"
          placeholder="0x…"
          aria-label={`Recipient ${index + 1} address`}
          value={recipient.address}
          onChange={(e) => onChange(index, 'address', e.target.value)}
          onBlur={() => onBlur(index, 'address')}
          disabled={disabled}
          className="mono w-full bg-transparent text-sm outline-none placeholder:text-slate-400 disabled:opacity-50"
          style={{ color: 'var(--ink)' }}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      {addrError && (
        <p className="text-xs pl-1" style={{ color: 'var(--danger)' }}>{addrError}</p>
      )}

      {/* Percent input */}
      <div
        className="rounded-2xl px-4 py-3 transition-colors focus-within:ring-2"
        style={{
          background: 'var(--surface-muted)',
          border: pctError ? '1.5px solid var(--danger)' : '1.5px solid var(--border)',
        }}
      >
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--subtle)' }}>
          Share (%)
        </label>
        <div className="flex items-baseline gap-1">
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            aria-label={`Recipient ${index + 1} percent`}
            value={recipient.percent}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.]/g, '')
              // At most one decimal point
              if ((v.match(/\./g) ?? []).length <= 1) onChange(index, 'percent', v)
            }}
            onBlur={() => onBlur(index, 'percent')}
            disabled={disabled}
            className="display w-full bg-transparent text-2xl font-bold tabular-nums outline-none placeholder:text-slate-300 disabled:opacity-50"
            style={{ color: 'var(--ink)' }}
          />
          <span className="text-lg font-medium" style={{ color: 'var(--subtle)' }}>%</span>
        </div>
      </div>
      {pctError && (
        <p className="text-xs pl-1" style={{ color: 'var(--danger)' }}>{pctError}</p>
      )}

      {/* Add recipient button after last row */}
      {canAdd && (
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold transition-all hover:opacity-80 disabled:opacity-40"
          style={{ border: '1.5px dashed var(--border)', color: 'var(--muted)' }}
        >
          <UserPlus className="size-4" />
          Add third recipient
        </button>
      )}
    </div>
  )
}
