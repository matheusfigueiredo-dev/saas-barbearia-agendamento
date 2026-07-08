export type BarberId = string

export type BarberProfile = {
  id: BarberId
  displayName: string
  photoUrl?: string | null
  accent?: string
}

export const BARBER_STORAGE_KEY = 'barbearia:selectedBarberId'

export function getFallbackBarbers(): BarberProfile[] {
  const env = import.meta.env as Record<string, string | undefined>
  return [
    {
      id: env.VITE_LUCAS_BARBER_ID || '',
      displayName: 'Lucas Dantas',
      photoUrl: env.VITE_LUCAS_BARBER_PHOTO || null,
      accent: 'from-emerald-400 via-cyan-400 to-emerald-600',
    },
    {
      id: env.VITE_VICTOR_BARBER_ID || '',
      displayName: 'Victor Emanuel',
      photoUrl: env.VITE_VICTOR_BARBER_PHOTO || null,
      accent: 'from-cyan-400 via-sky-500 to-emerald-500',
    },
  ].filter((barber) => Boolean(barber.id))
}

export function getBarberById(id?: string | null) {
  if (!id) return null
  return getFallbackBarbers().find((barber) => barber.id === id) ?? null
}
