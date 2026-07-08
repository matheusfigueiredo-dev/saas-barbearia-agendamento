import React from 'react'
import clsx from 'clsx'
import type { BarberProfile } from '../lib/barbers'

type Props = {
  barbers: BarberProfile[]
  selectedBarberId: string
  onSelect: (barber: BarberProfile) => void
}

export function BarberSelectionStep({ barbers, selectedBarberId, onSelect }: Props) {
  return (
    <section className="space-y-4">
      <div className="space-y-1 text-center sm:text-left">
        <p className="text-xs uppercase tracking-[0.35em] text-emerald-300/80">Seleção do profissional</p>
        <h2 className="text-xl font-semibold text-white">Escolha quem vai cuidar do seu corte</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {barbers.map((barber) => {
          const active = selectedBarberId === barber.id
          return (
            <button
              key={barber.id}
              type="button"
              onClick={() => onSelect(barber)}
              className={clsx(
                'group relative overflow-hidden rounded-3xl border p-3 text-left transition-all duration-300 focus:outline-none',
                active
                  ? 'border-emerald-400/80 ring-2 ring-emerald-500 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(16,185,129,0.25),0_18px_40px_rgba(16,185,129,0.16)]'
                  : 'border-neutral-800 bg-neutral-950/80 hover:border-neutral-700 hover:bg-neutral-900'
              )}
            >
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.12),transparent_55%)]" />
              <div className="relative space-y-3">
                <div className={clsx('relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br shadow-xl', barber.accent ?? 'from-neutral-700 to-neutral-900')}>
                  <div className="aspect-[4/3] sm:aspect-[5/4] w-full">
                    {barber.photoUrl ? (
                      <img src={barber.photoUrl} alt={barber.displayName} className="h-full w-full object-cover object-[center_34%] sm:object-[center_28%] transition-transform duration-500 group-hover:scale-[1.04]" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.22),rgba(255,255,255,0.04)_55%,rgba(0,0,0,0.2))] text-3xl font-bold text-black/75">
                        {barber.displayName
                          .split(' ')
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join('')}
                      </div>
                    )}
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-white/10" />
                  {active && (
                    <span className="absolute top-3 right-3 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-emerald-200 backdrop-blur-sm">
                      Selecionado
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-center px-2 pb-1 text-center">
                  <div>
                    <p className="text-lg font-semibold text-white tracking-tight">{barber.displayName}</p>
                    <div className="mx-auto mt-2 h-px w-14 bg-gradient-to-r from-transparent via-emerald-400/70 to-transparent" />
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
