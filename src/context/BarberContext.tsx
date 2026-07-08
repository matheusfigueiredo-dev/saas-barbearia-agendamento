import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { BARBER_STORAGE_KEY, getFallbackBarbers, type BarberId, type BarberProfile } from '../lib/barbers'
import { getSupabase } from '../lib/supabase'

type BarberSelectionContextValue = {
  selectedBarberId: BarberId
  setSelectedBarberId: (id: BarberId) => void
  selectedBarber: BarberProfile | null
  barbers: BarberProfile[]
}

const BarberSelectionContext = createContext<BarberSelectionContextValue | null>(null)

export function BarberSelectionProvider({ children }: { children: React.ReactNode }) {
  const [barbers, setBarbers] = useState<BarberProfile[]>(() => getFallbackBarbers())
  const [selectedBarberId, setSelectedBarberIdState] = useState<BarberId>(() => {
    if (typeof window === 'undefined') return getFallbackBarbers()[0]?.id ?? ''
    try {
      return window.localStorage.getItem(BARBER_STORAGE_KEY) || getFallbackBarbers()[0]?.id || ''
    } catch {
      return getFallbackBarbers()[0]?.id || ''
    }
  })

  useEffect(() => {
    let active = true
    async function loadBarbers() {
      try {
        const supa = getSupabase()
        const { data, error } = await supa
          .from('barbers')
          .select('id, display_name, photo_url, sort_order')
          .eq('active', true)
          .order('sort_order', { ascending: true })
          .order('display_name', { ascending: true })
        if (error || !Array.isArray(data) || data.length === 0) return
        const mapped = (data as any[]).map((row) => ({
          id: String(row.id),
          displayName: String(row.display_name || row.displayName || 'Barbeiro'),
          photoUrl: row.photo_url || row.photoUrl || null,
          accent: String(row.display_name || '').toLowerCase().includes('victor')
            ? 'from-cyan-400 via-sky-500 to-emerald-500'
            : 'from-emerald-400 via-cyan-400 to-emerald-600',
        })) satisfies BarberProfile[]
        if (!active) return
        setBarbers(mapped)
      } catch {
        // mantém fallback local
      }
    }
    void loadBarbers()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!barbers.length) return
    if (!selectedBarberId || !barbers.some((barber) => barber.id === selectedBarberId)) {
      setSelectedBarberIdState(barbers[0].id)
    }
  }, [barbers, selectedBarberId])

  useEffect(() => {
    try {
      window.localStorage.setItem(BARBER_STORAGE_KEY, selectedBarberId)
    } catch {}
  }, [selectedBarberId])

  const selectedBarber = useMemo(() => {
    return barbers.find((barber) => barber.id === selectedBarberId) ?? null
  }, [selectedBarberId, barbers])

  const value = useMemo<BarberSelectionContextValue>(() => ({
    selectedBarberId,
    setSelectedBarberId: setSelectedBarberIdState,
    selectedBarber,
    barbers,
  }), [selectedBarberId, selectedBarber, barbers])

  return <BarberSelectionContext.Provider value={value}>{children}</BarberSelectionContext.Provider>
}

export function useBarberSelection() {
  const context = useContext(BarberSelectionContext)
  if (!context) {
    throw new Error('useBarberSelection must be used within BarberSelectionProvider')
  }
  return context
}
