import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSupabase, setAuthPersistence } from '../lib/supabase'
import { getBookingColumns, getBookingSchema } from '../lib/bookingsSchema'
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from 'recharts'
// Geração de comprovante PDF será carregada dinamicamente apenas quando necessário

// Types
export type Booking = {
  id: string
  date: string
  time: string
  name: string
  phone?: string
  service?: string
  price?: number
  durationMinutes?: number
  _raw: any
}

export type Service = {
  id?: string
  title: string
  price: number
  minutes: number
  image?: string | null
}

export default function Admin() {
  // Auth state
  const [authReady, setAuthReady] = useState(false)
  const [isAuthed, setIsAuthed] = useState(false)
  const [barberId, setBarberId] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState<boolean>(() => {
    try { return (localStorage.getItem('rememberAdmin') ?? '1') !== '0' } catch { return true }
  })
  const [authErr, setAuthErr] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [panelReady, setPanelReady] = useState(false)
  const [splashVisible, setSplashVisible] = useState(true)
  const [splashFadeOut, setSplashFadeOut] = useState(false)

  useEffect(() => {
    const s = getSupabase()
    s.auth.getSession().then(({ data }) => {
      setIsAuthed(!!data.session)
      setBarberId(data.session?.user.id ?? null)
      setAuthReady(true)
    })
    const { data: sub } = s.auth.onAuthStateChange((_event, session) => {
      setIsAuthed(!!session)
      setBarberId(session?.user.id ?? null)
    })
    return () => { sub.subscription.unsubscribe() }
  }, [barberId])

  useEffect(() => {
    if (!authReady) return
    if (!splashVisible) return
    if (!isAuthed || panelReady) {
      setSplashFadeOut(true)
      const timeout = setTimeout(() => setSplashVisible(false), 600)
      return () => clearTimeout(timeout)
    }
    return undefined
  }, [authReady, isAuthed, panelReady, splashVisible])

  useEffect(() => {
    if (!isAuthed) return
    setPanelReady(false)
    setSplashVisible(true)
    setSplashFadeOut(false)
  }, [isAuthed])

  const handlePanelHydrated = useCallback(() => setPanelReady(true), [])

  async function signIn() {
    setAuthErr(null)
    setAuthLoading(true)
    try {
      setAuthPersistence(!!remember)
      const s = getSupabase()
      const { error } = await s.auth.signInWithPassword({ email, password })
      if (error) throw error
    } catch (e: any) {
      setAuthErr(e?.message || 'Falha ao entrar. Verifique suas credenciais.')
    } finally { setAuthLoading(false) }
  }

  async function signOut() {
    await getSupabase().auth.signOut()
  }

  const [activeTab, setActiveTab] = useState<'bookings' | 'services' | 'finance'>('bookings')
  const [financeBookings, setFinanceBookings] = useState<Booking[]>([])
  // Filtro de datas para Financeiro
  const todayStr = new Date().toISOString().slice(0,10)
  const dateNDaysAgo = (n:number) => new Date(Date.now() - (n*24*60*60*1000)).toISOString().slice(0,10)
  type Preset = 'today' | '7d' | '14d' | '30d' | 'last-month' | 'custom'
  const [financePreset, setFinancePreset] = useState<Preset>('7d')
  const [financeStart, setFinanceStart] = useState<string>(dateNDaysAgo(6)) // últimos 7 dias
  const [financeEnd, setFinanceEnd] = useState<string>(todayStr)

  // Carregamento de Financeiro (30 dias) e assinatura realtime
  const loadFinance = React.useCallback(async () => {
    try {
      if (!isAuthed || !barberId) return
      const s = getSupabase()
      const cols = await getBookingColumns(s)
      // Usa intervalo atual selecionado
      const start = (financeStart && financeEnd && financeStart > financeEnd) ? financeEnd : financeStart
      const end = (financeStart && financeEnd && financeStart > financeEnd) ? financeStart : financeEnd
      const sch = await getBookingSchema(s)
      const extraCols: string[] = []
      if (sch.servicesJsonCol) extraCols.push(sch.servicesJsonCol)
      if (sch.servicesCol) extraCols.push(sch.servicesCol)
      if (sch.statusCol) extraCols.push(sch.statusCol)
      if (sch.isCompletedCol) extraCols.push(sch.isCompletedCol)
      if (sch.completedAtCol) extraCols.push(sch.completedAtCol)
      const selectCols = ['id', cols.dateCol, cols.timeCol, 'name', 'phone', 'service', 'price', 'duration_minutes', ...extraCols].join(', ')
      const { data } = await s.from('bookings')
        .select(selectCols)
        .gte(cols.dateCol, start)
        .lte(cols.dateCol, end)
        .eq('barber_id', barberId)
      const mapped = ((data as any[])||[]).map(d => ({
        id: String(d.id), date: d[cols.dateCol], time: d[cols.timeCol], name: d.name, phone: d.phone, service: d.service, price: d.price, durationMinutes: d.duration_minutes, _raw: d
      })) as Booking[]
      setFinanceBookings(mapped)
    } catch {}
  }, [isAuthed, barberId, financeStart, financeEnd])

  useEffect(() => { void loadFinance() }, [loadFinance])

  useEffect(() => {
    if (!isAuthed || !barberId) return
    let active = true
    const s = getSupabase()
    const ch = s
      .channel(`finance-realtime-${barberId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `barber_id=eq.${barberId}` }, () => { if (!active) return; void loadFinance() })
      .subscribe()
    return () => { active = false; getSupabase().removeChannel(ch) }
  }, [isAuthed, barberId, loadFinance])

  // Quick presets helpers
  function applyPreset(p: Preset) {
    setFinancePreset(p)
    const now = new Date()
    const iso = (d:Date)=> d.toISOString().slice(0,10)
    if (p === 'today') {
      const d = iso(now)
      setFinanceStart(d); setFinanceEnd(d)
    } else if (p === '7d') {
      setFinanceStart(iso(new Date(now.getTime() - 6*86400000))); setFinanceEnd(iso(now))
    } else if (p === '14d') {
      setFinanceStart(iso(new Date(now.getTime() - 13*86400000))); setFinanceEnd(iso(now))
    } else if (p === '30d') {
      setFinanceStart(iso(new Date(now.getTime() - 29*86400000))); setFinanceEnd(iso(now))
    } else if (p === 'last-month') {
      const y = now.getUTCFullYear(); const m = now.getUTCMonth() // 0-11
      const firstThis = new Date(Date.UTC(y, m, 1))
      const firstPrev = new Date(Date.UTC(y, m-1, 1))
      const lastPrev = new Date(new Date(Date.UTC(y, m, 1)).getTime() - 86400000)
      setFinanceStart(iso(firstPrev)); setFinanceEnd(iso(lastPrev))
    }
  }

  const splashOverlay = splashVisible ? (
    <div className={`fixed inset-0 z-[70] flex flex-col items-center justify-center bg-neutral-950 transition-opacity duration-700 ${splashFadeOut ? 'opacity-0 pointer-events-none' : ''}`}>
      <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.25),transparent_55%)]" />
      <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_bottom,_rgba(14,165,233,0.25),transparent_60%)]" />
      <div className="relative flex flex-col items-center gap-6 text-center">
        <div className="w-32 h-32 rounded-full bg-gradient-to-br from-emerald-400 via-cyan-400 to-purple-500 p-[3px] animate-[spin_2.8s_linear_infinite] shadow-[0_0_60px_rgba(16,185,129,0.25)]">
          <div className="w-full h-full rounded-full bg-neutral-950 flex items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 blur-[1px] animate-pulse shadow-[0_0_30px_rgba(6,182,212,0.7)]" />
          </div>
        </div>
        <div className="relative">
          <p className="text-sm uppercase tracking-[0.5em] text-white/70">Carregando</p>
          <p className="mt-2 text-white/60 text-xs tracking-[0.35em]">Dantas Barber Shop</p>
        </div>
      </div>
    </div>
  ) : null

  if (!authReady) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center relative overflow-hidden">
        {splashOverlay}
        <div className="text-neutral-400 text-sm">Verificando sessão...</div>
      </div>
    )
  }

  if (!isAuthed) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white relative overflow-hidden">
        {splashOverlay}
        <div className="max-w-md mx-auto px-4 py-10">
          <header className="mb-6 flex items-center gap-3">
            <Link to="/" className="h-9 px-3 inline-flex items-center rounded bg-neutral-800 border border-neutral-700 hover:bg-neutral-700">Início</Link>
            <h1 className="text-xl font-semibold">Entrar</h1>
          </header>
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
            <div className="grid gap-3">
              <label className="text-sm text-neutral-300">Email</label>
              <input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="admin@exemplo.com" className="bg-neutral-950 border border-neutral-800 rounded px-3 py-2" />
              <label className="text-sm text-neutral-300 mt-2">Senha</label>
              <input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="••••••••" className="bg-neutral-950 border border-neutral-800 rounded px-3 py-2" />
              <label className="inline-flex items-center gap-2 text-sm text-neutral-300 mt-2">
                <input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)} className="accent-emerald-500" />
                Manter logado
              </label>
              {authErr && <p className="text-sm text-red-400">{authErr}</p>}
              <button onClick={signIn} disabled={authLoading} className="mt-2 px-4 py-2 rounded bg-emerald-500 text-black font-semibold disabled:opacity-60">{authLoading ? 'Entrando...' : 'Entrar'}</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white relative overflow-hidden">
      {splashOverlay}
      <div className="max-w-5xl mx-auto px-4 py-8">
        <header className="mb-6">
          <div className="flex items-center gap-3">
            <Link to="/" className="h-9 px-3 inline-flex items-center rounded bg-neutral-800 border border-neutral-700 hover:bg-neutral-700">Início</Link>
            <h1 className="text-xl font-semibold">Gestão</h1>
            <div className="ml-auto">
              <button onClick={signOut} className="h-9 px-3 inline-flex items-center rounded bg-neutral-800 border border-neutral-700 hover:bg-neutral-700">Sair</button>
            </div>
          </div>
          <div className="mt-4">
            <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-1">
              <div className="grid grid-cols-3 gap-1">
                <button onClick={()=>setActiveTab('bookings')} className={`h-10 rounded-md text-sm font-medium transition ${activeTab==='bookings' ? 'bg-emerald-600 text-black' : 'bg-neutral-800 text-white hover:bg-neutral-700'}`}>Agendamentos</button>
                <button onClick={()=>setActiveTab('services')} className={`h-10 rounded-md text-sm font-medium transition ${activeTab==='services' ? 'bg-emerald-600 text-black' : 'bg-neutral-800 text-white hover:bg-neutral-700'}`}>Serviços</button>
                <button onClick={()=>setActiveTab('finance')} className={`h-10 rounded-md text-sm font-medium transition ${activeTab==='finance' ? 'bg-emerald-600 text-black' : 'bg-neutral-800 text-white hover:bg-neutral-700'}`}>Financeiro</button>
              </div>
            </div>
          </div>
        </header>

        {activeTab==='bookings' && (
          <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 overflow-hidden">
            <h2 className="text-lg font-semibold mb-3">Agendamentos do período</h2>
            <BookingsPanel barberId={barberId} onInitialHydrated={handlePanelHydrated} />
          </section>
        )}

        {activeTab==='services' && (
          <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 overflow-hidden">
            <h2 className="text-lg font-semibold mb-3">Serviços</h2>
            <ServicesPanel barberId={barberId} />
          </section>
        )}

        {activeTab==='finance' && (
          <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 overflow-hidden">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="text-lg font-semibold">Financeiro</h2>
            </div>
            {/* Filtros de período */}
            <div className="mb-4">
              <div className="overflow-x-auto pb-2">
                <div className="flex gap-2 min-w-max">
                  {([
                    {k:'today', label:'Hoje'},
                    {k:'7d', label:'7 dias'},
                    {k:'14d', label:'14 dias'},
                    {k:'30d', label:'30 dias'},
                    {k:'last-month', label:'Último mês'}
                  ] as {k:Preset,label:string}[]).map(p => (
                    <button key={p.k} onClick={()=>applyPreset(p.k)} className={`h-9 px-3 rounded-md text-sm font-medium ${financePreset===p.k? 'bg-emerald-600 text-black' : 'bg-neutral-800 text-white hover:bg-neutral-700'}`}>{p.label}</button>
                  ))}
                </div>
              </div>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="flex flex-col">
                  <label className="text-xs text-neutral-300 mb-1">Data inicial</label>
                  <input type="date" value={financeStart} max={financeEnd||undefined} onChange={(e)=>{ setFinancePreset('custom'); const v=e.target.value; if(!v)return; setFinanceStart(v) }} className="bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-white"/>
                </div>
                <div className="flex flex-col">
                  <label className="text-xs text-neutral-300 mb-1">Data final</label>
                  <input type="date" value={financeEnd} min={financeStart||undefined} max={todayStr} onChange={(e)=>{ setFinancePreset('custom'); const v=e.target.value; if(!v)return; setFinanceEnd(v) }} className="bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-white"/>
                </div>
              </div>
            </div>
            <FinanceiroPanel bookings={financeBookings} startDate={financeStart} endDate={financeEnd} />
          </section>
        )}
      </div>
    </div>
  )
}

function ServicesPanel({ barberId }: { barberId: string | null }) {
  const [items, setItems] = useState<Service[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<Service>({ title: '', price: 0, minutes: 0, image: '' })
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!barberId) return
    const { data, error } = await getSupabase().from('services_catalog').select('*').eq('barber_id', barberId).order('title', { ascending: true })
    if (!error) {
      const list = ((data as any[]) || []).map(d => ({ id: d.id, title: d.title, price: d.price, minutes: d.minutes, image: d.image || null }))
      setItems(list)
    }
  }, [barberId])

  useEffect(() => { void load() }, [load])

  function openFilePicker() {
    setUploadError(null)
    fileInputRef.current?.click()
  }

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    setUploadError(null)
    const file = e.target.files?.[0]
    if (!file) return
    // Limite opcional de ~700KB para evitar Data URLs muito grandes
    const maxBytes = 700 * 1024
    if (file.size > maxBytes) {
      setUploadError('Imagem muito grande. Selecione uma imagem até ~700KB.')
      e.target.value = ''
      return
    }
    setUploadingImage(true)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('Falha ao ler a imagem'))
        reader.onload = () => resolve(String(reader.result || ''))
        reader.readAsDataURL(file)
      })
      setForm((f) => ({ ...f, image: dataUrl }))
    } catch (err) {
      setUploadError('Não foi possível processar a imagem.')
    } finally {
      setUploadingImage(false)
      e.target.value = ''
    }
  }

  async function save() {
    setSaving(true)
    try {
      const supa = getSupabase()
      if (!barberId) throw new Error('Barbeiro autenticado não encontrado.')
      if (editingId) {
        const { error } = await supa.from('services_catalog').update({ title: form.title, price: form.price, minutes: form.minutes, image: form.image || null }).eq('id', editingId).eq('barber_id', barberId)
        if (error) throw error
      } else {
        const { error } = await supa.from('services_catalog').insert({ title: form.title, price: form.price, minutes: form.minutes, image: form.image || null, barber_id: barberId })
        if (error) throw error
      }
      setForm({ title: '', price: 0, minutes: 0, image: '' })
      setEditingId(null)
      await load()
    } catch (e) {
      alert('Erro ao salvar serviço')
    } finally { setSaving(false) }
  }

  async function remove(id?: string) {
    if (!id) return
    if (!confirm('Excluir este serviço?')) return
    if (!barberId) return
    const { error } = await getSupabase().from('services_catalog').delete().eq('id', id).eq('barber_id', barberId)
    if (!error) await load()
  }

  return (
    <div className="grid gap-4">
      <div className="grid sm:grid-cols-4 gap-2">
        <input value={form.title} onChange={e=>setForm(f=>({ ...f, title: e.target.value }))} placeholder="Título" aria-label="Título do serviço" className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-2" />
  <input type="number" value={form.price === 0 ? '' : form.price} onChange={e=>setForm(f=>({ ...f, price: Number(e.target.value) }))} placeholder="Valor (R$)" aria-label="Valor em reais" className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-2" />
  <input type="number" value={form.minutes === 0 ? '' : form.minutes} onChange={e=>setForm(f=>({ ...f, minutes: Number(e.target.value) }))} placeholder="Tempo (min)" aria-label="Duração em minutos" className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-2" />
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept="image/*" onChange={onFileSelected} className="hidden" />
          <button type="button" onClick={openFilePicker} className="w-full px-3 py-2 rounded bg-neutral-800 border border-neutral-700 hover:bg-neutral-700 text-sm">{uploadingImage ? 'Carregando...' : 'Selecionar imagem'}</button>
        </div>
      </div>
      {uploadError && (<p className="text-sm text-red-400">{uploadError}</p>)}
      {form.image && (
        <div className="flex items-center gap-3">
          <img src={form.image || ''} alt="Prévia do serviço" className="w-20 h-20 object-cover rounded-lg border border-neutral-800" />
          <div className="flex gap-2">
            <button type="button" onClick={openFilePicker} className="px-3 py-1.5 rounded bg-neutral-800 border border-neutral-700">Trocar imagem</button>
            <button type="button" onClick={()=>setForm(f=>({ ...f, image: '' }))} className="px-3 py-1.5 rounded bg-red-600">Remover</button>
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="px-4 py-2 rounded bg-emerald-500 text-black font-semibold disabled:opacity-60">{editingId ? 'Salvar' : 'Adicionar'}</button>
        {editingId && (<button onClick={()=>{ setEditingId(null); setForm({ title:'', price:0, minutes:0, image:''}) }} className="px-4 py-2 rounded bg-neutral-800 border border-neutral-700">Cancelar</button>)}
      </div>

      <div className="grid gap-4 w-full">
        {items.map(s => (
          <div key={s.id} className="w-full overflow-hidden flex items-center gap-4 bg-neutral-950 border border-neutral-800 rounded-xl p-4">
            {s.image ? (
              <img src={s.image} alt={s.title} className="w-20 h-20 sm:w-24 sm:h-24 object-cover rounded-lg" />
            ) : (
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg bg-neutral-800" />
            )}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-white text-base sm:text-lg whitespace-normal break-words">{s.title}</p>
              <p className="text-sm text-neutral-400 whitespace-normal break-words">{s.minutes} min • R$ {Number(s.price||0).toFixed(2)}</p>
            </div>
            <div className="ml-auto flex flex-col gap-1 items-stretch">
              <button onClick={()=>{ setEditingId(String(s.id)); setForm({ title: s.title, price: s.price, minutes: s.minutes, image: s.image || '' }) }} className="px-2.5 py-1 rounded bg-neutral-800 border border-neutral-700 text-sm">Editar</button>
              <button onClick={()=>remove(s.id)} className="px-2.5 py-1 rounded bg-red-600 text-sm">Excluir</button>
            </div>
          </div>
        ))}
        {items.length===0 && <p className="text-sm text-neutral-400">Nenhum serviço cadastrado.</p>}
      </div>
    </div>
  )
}

function FinanceiroPanel({ bookings, startDate, endDate }: { bookings: Booking[]; startDate?: string; endDate?: string }) {
  // Garante intervalo válido
  const s = startDate || new Date(Date.now() - 6*86400000).toISOString().slice(0,10)
  const e = endDate || new Date().toISOString().slice(0,10)
  const start = s <= e ? s : e
  const end = s <= e ? e : s
  const startD = new Date(`${start}T00:00:00`)
  const endD = new Date(`${end}T00:00:00`)
  const days = Math.max(1, Math.floor((endD.getTime() - startD.getTime())/86400000) + 1)
  const revenueByDay = new Map<string, number>()
  for (let i = 0; i < days; i++) {
    const d = new Date(startD.getTime() + i * 86400000)
    if (d.getDay() === 0) continue // Oculta domingos no gráfico diário
    const key = d.toISOString().slice(0, 10)
    revenueByDay.set(key, 0)
  }
  bookings.forEach(b => {
    const key = (b.date || '').slice(0, 10)
    const val = typeof b.price === 'number' ? b.price : 0
    if (revenueByDay.has(key)) revenueByDay.set(key, (revenueByDay.get(key) || 0) + val)
  })
  const revenueTrend = Array.from(revenueByDay.entries()).map(([date, value]) => ({ date, value }))

  const parseLocalDate = (value?: string | null) => {
    if (!value) return null
    const datePart = value.slice(0, 10)
    const [y, m, d] = datePart.split('-').map(Number)
    if ([y, m, d].some(n => Number.isNaN(n))) return null
    return new Date(y, (m || 1) - 1, d || 1)
  }

  const normalizeHHmm = (value?: string | null) => {
    if (!value) return ''
    const raw = String(value).trim()
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) {
      const [hh, mm] = raw.split(':')
      return `${String(hh).padStart(2, '0')}:${mm}`
    }
    if (/^\d{4}$/.test(raw)) return `${raw.slice(0, 2)}:${raw.slice(2)}`
    if (/^\d{1,2}$/.test(raw)) return `${String(Number(raw)).padStart(2, '0')}:00`
    return raw
  }

  const normalizeServiceName = (value?: string) => {
    if (!value) return 'Sem serviço'
    let cleaned = value.trim()
    const prefixPattern = /^\s*(avulso|avulsos|avulsa|avulsas|agendar|agendamento|agenda|agendado|agendados)\s*[:\-–]?\s*/i
    while (prefixPattern.test(cleaned)) {
      cleaned = cleaned.replace(prefixPattern, '').trim()
    }
    cleaned = cleaned.replace(/^[:\-–]\s*/, '').trim()
    return cleaned || 'Sem serviço'
  }

  // Helper: detecta se booking está concluído (inclui AVULSO e colunas dinâmicas)
  function isCompleted(b: Booking): boolean {
    const r = b._raw || {}
    // 1) Colunas comuns
    if (typeof r.is_completed !== 'undefined') return !!r.is_completed
    if (typeof r.done !== 'undefined') return !!r.done
    if (r.completed_at) return true
    // 2) Heurística: qualquer coluna que sugira "completed"
    for (const k of Object.keys(r)) {
      const lk = k.toLowerCase()
      if (/(completed|conclu|finalizado)/.test(lk)) {
        const v = (r as any)[k]
        if (typeof v === 'boolean' && v) return true
        if (typeof v === 'string') {
          const s = v.toLowerCase().trim()
          // data válida conta como concluído
          const d = new Date(v)
          if (!isNaN(d.getTime())) return true
          if (/(concluido|concluído|finalizado|feito|done|completed|complete)/.test(s)) return true
        }
        if (v && typeof v === 'number') return true
      }
    }
    // 3) Status textual
    const st = (r.status || r.booking_status || r.state || '').toString().toLowerCase()
    if (st) {
      if (st === 'avulso') return true
      const tokens = ['concluido','concluído','finalizado','feito','done','completed','complete']
      if (tokens.some(t => st.includes(t))) return true
    }
    return false
  }

  const completedBookings = bookings.filter(isCompleted)

  // Agregações usando serviços individuais se disponíveis (services_json), senão usa campo service simples.
  const revenueByService = new Map<string, number>()
  const countByService = new Map<string, number>()
  let totalServicesCount = 0
  completedBookings.forEach(b => {
    const raw = b._raw || {}
    let servicesList: Array<{ title?: string; price?: number }> | null = null
    const sj = raw.services_json || raw.services_detail || raw.services_list
    if (Array.isArray(sj)) servicesList = sj
    else {
      const alt = raw.services || raw.servicos || raw.services_ids || raw.services_names || raw.itens || raw.items
      if (typeof alt === 'string') {
        try { const parsed = JSON.parse(alt); if (Array.isArray(parsed)) servicesList = parsed } catch {}
      } else if (Array.isArray(alt)) servicesList = alt
    }
    if (servicesList && servicesList.length > 0) {
      servicesList.forEach(svc => {
        const name = normalizeServiceName(svc.title || 'Serviço')
        const price = typeof svc.price === 'number' ? svc.price : 0
        revenueByService.set(name, (revenueByService.get(name) || 0) + price)
        countByService.set(name, (countByService.get(name) || 0) + 1)
        totalServicesCount++
      })
    } else {
      // Fallback: campo texto único 'service' pode conter múltiplos serviços separados por vírgula
      const rawNames = (b.service || '').split(',').map((s:string)=>s.trim()).filter(Boolean)
      const names = rawNames.length > 0 ? rawNames : ['Sem serviço']
      const totalPrice = typeof b.price === 'number' ? b.price : 0
      const perItemPrice = names.length > 0 ? totalPrice / names.length : 0
      names.forEach(n => {
        const name = normalizeServiceName(n)
        revenueByService.set(name, (revenueByService.get(name) || 0) + perItemPrice)
        countByService.set(name, (countByService.get(name) || 0) + 1)
        totalServicesCount++
      })
    }
  })
  const revenueByServiceData = Array.from(revenueByService.entries())
    .map(([name, value]) => ({ name, value: Number((value || 0).toFixed(2)) }))
    .sort((a, b) => (b.value || 0) - (a.value || 0))
  const countByServiceData = Array.from(countByService.entries()).map(([name, value]) => ({ name, value }))
  countByServiceData.sort((a, b) => (b.value || 0) - (a.value || 0))

  const weekdayLabels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  const weekdayCounts = new Array(6).fill(0)
  bookings.forEach(b => {
    const d = parseLocalDate(b.date)
    if (!d) return
    if (d < startD || d > endD) return
    const dow = d.getDay()
    if (dow >= 1 && dow <= 6) weekdayCounts[dow - 1]++
  })
  const weekdayData = weekdayLabels.map((name, idx) => ({ name, value: weekdayCounts[idx] }))

  const timeCount = new Map<string, number>()
  bookings.forEach(b => {
    const d = parseLocalDate(b.date)
    if (!d || d < startD || d > endD) return
    const hhmm = normalizeHHmm(b.time)
    if (!hhmm) return
    if (hhmm === '23:59' || hhmm === '23:59:00') return
    timeCount.set(hhmm, (timeCount.get(hhmm) || 0) + 1)
  })
  const topTimes = Array.from(timeCount.entries()).sort((a,b)=> b[1]-a[1]).slice(0,10).map(([name,value])=>({ name, value }))

  // Receita adquirida total últimos 30 dias (apenas concluídos)
  const totalRevenue = completedBookings.reduce((s,b)=>s + (typeof b.price === 'number' ? b.price : 0), 0)

  // Número total de serviços concluídos (soma de todos os serviços individuais)
  const totalServices = totalServicesCount

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Faturamento" value={`R$ ${totalRevenue.toFixed(2)}`} />
        <StatCard title="Agendamentos" value={`${completedBookings.length}`} />
        <StatCard title="Serviços" value={`${totalServices}`} />
        <StatCard title="Ticket médio" value={`R$ ${(totalRevenue/(completedBookings.length||1)).toFixed(2)}`} />
      </div>

      <ChartCard title="Faturamento por data">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={revenueTrend} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
              <XAxis dataKey="date" stroke="#9ca3af" tick={{ fontSize: 12 }} />
              <YAxis stroke="#9ca3af" tick={{ fontSize: 12 }} />
              <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151' }} />
              <Legend />
              <Line type="monotone" dataKey="value" name="Faturamento" stroke="#34d399" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title="Faturamento por serviço">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={revenueByServiceData} margin={{ top: 10, right: 16, left: 0, bottom: 32 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
              <XAxis dataKey="name" stroke="#9ca3af" tick={{ fontSize: 12 }} interval={0} angle={-20} textAnchor="end" height={50} />
              <YAxis stroke="#9ca3af" tick={{ fontSize: 12 }} />
              <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151' }} />
              <Legend />
              <Bar dataKey="value" name="R$" fill="#60a5fa" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title="Quantidade por serviço">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={countByServiceData} margin={{ top: 10, right: 16, left: 0, bottom: 32 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
              <XAxis dataKey="name" stroke="#9ca3af" tick={{ fontSize: 12 }} interval={0} angle={-20} textAnchor="end" height={50} />
              <YAxis stroke="#9ca3af" tick={{ fontSize: 12 }} />
              <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151' }} />
              <Legend />
              <Bar dataKey="value" name="Qtd" fill="#34d399" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title="Agendamentos por dia da semana">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weekdayData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
              <XAxis dataKey="name" stroke="#9ca3af" tick={{ fontSize: 12 }} />
              <YAxis stroke="#9ca3af" tick={{ fontSize: 12 }} />
              <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151' }} />
              <Legend />
              <Bar dataKey="value" name="Qtd" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title="Horários mais populares">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topTimes} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
              <XAxis dataKey="name" stroke="#9ca3af" tick={{ fontSize: 12 }} />
              <YAxis stroke="#9ca3af" tick={{ fontSize: 12 }} />
              <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151' }} />
              <Legend />
              <Bar dataKey="value" name="Qtd" fill="#a78bfa" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    </div>
  )
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3 sm:p-4 overflow-hidden">
      <p className="text-sm text-neutral-400">{title}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
      <p className="text-sm text-neutral-400 mb-3">{title}</p>
      {children}
    </div>
  )
}

// Função utilitária global para extrair nomes de serviços
function extractServiceNamesFromRecord(rec: any, booking: any, schema: any, serviceCatalog: Record<string,string>): string[] {
  const stripPrefixes = (txt?: string) => String(txt || '')
    .replace(/^\s*AGENDAR\s*:\s*/i, '')
    .replace(/^\s*AVULSO\s*:\s*/i, '')
    .trim()
  try {
    const d = (rec || {}) as any
    const col = schema?.servicesJsonCol
    let raw: any = col ? d[col] : undefined
    if (!raw && (schema as any)?.servicesCol) raw = d[(schema as any).servicesCol]
    if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch {} }
    let arr: any[] | null = null
    if (Array.isArray(raw)) arr = raw
    else if (raw && Array.isArray(raw.items)) arr = raw.items
    const candidateKeys = ['services','servicos','services_list','services_detail','itens','items']
    if (!arr) {
      for (const k of candidateKeys) {
        if (Array.isArray(d?.[k])) { arr = d[k]; break }
        const v = d?.[k]
        if (typeof v === 'string' && v.trim().startsWith('[')) { try { const parsed = JSON.parse(v); if (Array.isArray(parsed)) { arr = parsed; break } } catch {} }
      }
    }
    if (!arr) {
      for (const [k,v] of Object.entries(d)) {
        if (typeof v === 'string') {
          const s = v.trim()
            if ((s.startsWith('[') && s.endsWith(']')) || (s.startsWith('{') && s.endsWith('}'))) {
              try { const parsed = JSON.parse(s); if (Array.isArray(parsed)) { arr = parsed; break } } catch {}
            }
        }
      }
    }
    if (!arr || arr.length===0) {
      const s = booking?.service ?? d?.service
      if (typeof s === 'string') {
        if (s.trim().startsWith('[') && s.trim().endsWith(']')) { try { const parsed = JSON.parse(s); if (Array.isArray(parsed)) arr = parsed } catch {} }
        if ((!arr || arr.length===0) && s.includes(',')) arr = s.split(',').map(v=>stripPrefixes(v)).filter(Boolean)
      }
    }
    if (Array.isArray(arr) && arr.length>0) {
      return arr.map((it:any)=> {
        if (typeof it === 'string') { const direct = stripPrefixes(it); return serviceCatalog[direct] || direct }
        if (typeof it === 'number') { const key = String(it); return serviceCatalog[key] || key }
        const byField = stripPrefixes(String(it?.title ?? it?.titulo ?? it?.name ?? it?.service ?? it?.label ?? ''))
        if (byField) return serviceCatalog[byField] || byField
        const maybeId = it?.id != null ? String(it.id) : String(it?.serviceId ?? it?.servicoId ?? '')
        if (maybeId && serviceCatalog[maybeId]) return serviceCatalog[maybeId]
        return maybeId || ''
      }).filter(Boolean)
    }
  } catch {}
  return []
}

function BookingsPanel({ barberId, onInitialHydrated }: { barberId: string | null; onInitialHydrated?: () => void } = { barberId: null }) {
  // Intervalo de datas: inicial e final (default: hoje)
  const [startDate, setStartDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [items, setItems] = useState<Booking[]>([])
  const [schema, setSchema] = useState<Awaited<ReturnType<typeof getBookingSchema>> | null>(null)
  const [estimated, setEstimated] = useState(0)
  const [completedTotal, setCompletedTotal] = useState(0)
  const [actingId, setActingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [doneCount, setDoneCount] = useState(0)
  const [agendarCount, setAgendarCount] = useState(0)
  const [cancelarCount, setCancelarCount] = useState(0)
  const [showCompleted, setShowCompleted] = useState(false)
  const [selected, setSelected] = useState<any | null>(null)
  // Catálogo para mapear IDs -> títulos quando o JSON não traz nome
  const [serviceCatalog, setServiceCatalog] = useState<Record<string, string>>({})
  // Avulso modal state
  const [avulsoOpen, setAvulsoOpen] = useState(false)
  const [avulsoName, setAvulsoName] = useState('')
  const [avulsoDate, setAvulsoDate] = useState<string>(() => new Date().toISOString().slice(0,10))
  const [avulsoServices, setAvulsoServices] = useState<{id:string,title:string,price:number,minutes:number}[]>([])
  const [avulsoSelectedIds, setAvulsoSelectedIds] = useState<string[]>([])
  const [avulsoSaving, setAvulsoSaving] = useState(false)
  const [avulsoConfirm, setAvulsoConfirm] = useState<null | {
    name: string;
    date: string;
    items: { id:string; title:string; price:number; minutes:number }[];
    totalPrice: number;
    totalMinutes: number;
  }>(null)
  // Bloqueio modal state
  const [blockOpen, setBlockOpen] = useState(false)
  const [blockDate, setBlockDate] = useState<string>(() => new Date().toISOString().slice(0,10))
  const [blockStart, setBlockStart] = useState<string>('')
  const [blockEnd, setBlockEnd] = useState<string>('')
  const [blockSaving, setBlockSaving] = useState(false)
  const [blockConfirm, setBlockConfirm] = useState<null | { date: string; start: string; end: string }>(null)
  const hydratedRef = useRef(false)
  const signalHydrated = useCallback(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    onInitialHydrated?.()
  }, [onInitialHydrated])

  // === Notificações (ícone flutuante) ===
  const STORAGE_KEY = 'barber:notificationsRead:v1'
  // Lista global de agendamentos (todas as datas) usada só para notificações
  const [notifItems, setNotifItems] = useState<Booking[]>([])
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return new Set<string>()
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return new Set(arr.map(String))
    } catch {}
    return new Set<string>()
  })
  const [notifOpen, setNotifOpen] = useState(false)
  // Persiste quando altera
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(readIds))) } catch {}
  }, [readIds])
  // Faz uma limpeza de IDs que não existem mais no conjunto global atual
  useEffect(() => {
    if (!notifItems || notifItems.length === 0) return
    const present = new Set(notifItems.map(b => b.id))
    let changed = false
    const next = new Set<string>()
    readIds.forEach(id => { if (present.has(id)) next.add(id); else changed = true })
    if (changed) setReadIds(next)
  }, [notifItems])
  const unreadItems = notifItems.filter(b => !readIds.has(b.id))
  const unreadCount = unreadItems.length
  const markAsRead = (id: string) => setReadIds(prev => new Set(prev).add(id))
  const markAllAsRead = () => setReadIds(new Set(notifItems.map(b => b.id)))

  // Carrega agendamentos globais (todas as datas) somente para notificação
  const loadNotificationsAll = useCallback(async () => {
    try {
      if (!barberId) return
      const supa = getSupabase()
      const cols = await getBookingColumns(supa)
      const sch = await getBookingSchema(supa)
      const baseSelect = `id, ${cols.dateCol}, ${cols.timeCol}, name${sch.servicesJsonCol ? `, ${sch.servicesJsonCol}` : ''}${(sch as any).servicesCol ? `, ${(sch as any).servicesCol}` : ''}`
      const trySelect = async (sel: string) => (
        await (supa.from('bookings') as any)
          .select(sel)
          .eq('barber_id', barberId)
          .order(cols.dateCol, { ascending: false })
          .order(cols.timeCol, { ascending: false })
          .limit(300)
      )
      // Primeiro tenta com created_at; se der erro (coluna não existe), faz fallback sem ela
      let data: any[] | null = null
      {
        const { data: d1, error: e1 } = await trySelect(baseSelect + ', created_at')
        if (!e1) {
          data = (d1 as any[]) || []
        } else {
          const { data: d2, error: e2 } = await trySelect(baseSelect)
          if (e2) throw e2
          data = (d2 as any[]) || []
        }
      }
      const mapped = (data || []).map(d => ({ id: String(d.id), date: d[cols.dateCol], time: d[cols.timeCol], name: d.name, _raw: d })) as Booking[]
      setNotifItems(mapped)
    } catch {}
  }, [barberId])

  // Inicializa notificações globais e assina realtime separado
  useEffect(() => { void loadNotificationsAll() }, [loadNotificationsAll])
  useEffect(() => {
    let active = true
    const supa = getSupabase()
    const ch = supa
      .channel(`notifications-all-${barberId ?? 'none'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: barberId ? `barber_id=eq.${barberId}` : 'barber_id=eq.__none__' }, () => { if (!active) return; void loadNotificationsAll() })
      .subscribe()
    return () => { active = false; getSupabase().removeChannel(ch) }
  }, [barberId, loadNotificationsAll])

  useEffect(() => {
    (async () => {
      try {
        if (!barberId) return
        const supa = getSupabase()
        const map: Record<string,string> = {}
        // Carrega catálogo oficial
        const { data, error } = await supa.from('services_catalog').select('id, title, price, minutes').eq('barber_id', barberId)
        if (!error && Array.isArray(data)) {
          for (const row of data as any[]) {
            const name = String(row?.title ?? '').trim()
            if (row?.id != null && name) map[String(row.id)] = name
          }
          // Também guarda lista detalhada para Avulso
          setAvulsoServices(((data as any[])||[]).map(r=>({ id:String(r.id), title:String(r.title||'').trim(), price:Number(r.price||0), minutes:Number(r.minutes||0) })))
        }
        setServiceCatalog(map)
      } catch {}
    })()
  }, [barberId])

  // Wrapper para manter assinatura anterior dentro do componente
  const getServiceNames = (rec: any, booking?: Booking) => extractServiceNamesFromRecord(rec, booking, schema, serviceCatalog)

  function displayTime(t?: string): string {
    if (!t) return '–'
    const s = String(t).trim()
    let hh = '00'
    let mm = '00'
    // HH:mm or HH:mm:ss
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
      const [h, m] = s.split(':')
      hh = String(h).padStart(2, '0')
      mm = String(m).padStart(2, '0')
    } else if (/^\d{4}$/.test(s)) {
      // HHmm
      hh = s.slice(0, 2)
      mm = s.slice(2)
    } else if (/^\d{1,2}$/.test(s)) {
      // H or HH
      hh = String(Number(s)).padStart(2, '0')
      mm = '00'
    } else {
      // Fallback: tenta extrair partes numéricas
      const m = s.match(/(\d{1,2}):?(\d{2})?/)
      if (m) {
        hh = String(m[1]).padStart(2, '0')
        mm = String(m[2] ?? '00').padStart(2, '0')
      } else {
        return s
      }
    }
    return `${hh}h${mm}`
  }

  function formatDatePt(d?: string): string {
    if (!d) return '–'
    const parts = d.split('-')
    if (parts.length >= 3) {
      const [y, m, day] = parts
      return `${day}/${m}`
    }
    return d
  }

  // Formata dd-mm-aaaa (para notificações)
  function formatDatePtFull(d?: string, sep: string = '-') {
    if (!d) return '–'
    const m = /^\d{4}-\d{2}-\d{2}/.exec(d)
    if (m) {
      const [y, mo, day] = d.slice(0,10).split('-')
      return `${day}${sep}${mo}${sep}${y}`
    }
    return d
  }

  // Abre modal de detalhes a partir de uma notificação (busca registro completo por ID)
  async function openNotification(b: Booking) {
    try {
      if (!barberId) return
      const supa = getSupabase()
      const cols = await getBookingColumns(supa)
      const sch = await getBookingSchema(supa)
      // tenta com created_at e faz fallback sem ela
      const selectBase = `id, ${cols.dateCol}, ${cols.timeCol}, name, phone, service, price, duration_minutes${sch.statusKind==='text' && sch.statusCol ? `, ${sch.statusCol}` : ''}${sch.statusKind==='boolean' && sch.isCompletedCol ? `, ${sch.isCompletedCol}` : ''}${sch.completedAtCol ? `, ${sch.completedAtCol}` : ''}${sch.servicesJsonCol ? `, ${sch.servicesJsonCol}` : ''}${(sch as any).servicesCol ? `, ${(sch as any).servicesCol}` : ''}`
      let row: any = null
      {
        const { data: d1, error: e1 } = await (supa.from('bookings') as any)
          .select(selectBase + ', created_at')
          .eq('id', b.id)
          .eq('barber_id', barberId)
          .limit(1)
        if (!e1 && Array.isArray(d1) && d1[0]) row = d1[0]
        else {
          const { data: d2, error: e2 } = await (supa.from('bookings') as any)
            .select(selectBase)
            .eq('id', b.id)
            .eq('barber_id', barberId)
            .limit(1)
          if (e2) throw e2
          row = Array.isArray(d2) && d2[0] ? d2[0] : null
        }
      }
      if (!row) return
      const full: Booking = {
        id: String(row.id),
        date: row[cols.dateCol],
        time: row[cols.timeCol],
        name: row.name,
        phone: row.phone,
        service: row.service,
        price: row.price,
        durationMinutes: row.duration_minutes,
        _raw: row
      }
      setSelected(full)
    } catch {}
  }

  function normalizePhoneForWhats(phone?: string | null): string | null {
    const digits = String(phone || '').replace(/\D/g, '')
    if (!digits) return null
    let n = digits
    // remove zeros à esquerda comuns em discagem local
    while (n.startsWith('0')) n = n.slice(1)
    // se for número BR sem DDI (10 ou 11 dígitos), prefixa 55
    if (!n.startsWith('55') && (n.length === 10 || n.length === 11)) {
      n = '55' + n
    }
    // aceita comprimentos típicos BR com DDI (12 ou 13) também
    if (n.length < 10) return null
    return n
  }

  function buildWhatsMessage(b: Booking): string {
    const nome = b.name || 'cliente'
    const servico = b.service || 'seu serviço'
    const data = formatDatePt(b.date)
    const horario = displayTime(b.time)
    return `Fala, ${nome}! Seu rolê tá marcado: ${servico} em ${data} às ${horario}.\nPode chegar tranquilo que o estilo tá garantido! \nTamo junto, até breve na Dantas Barber Shop!`
  }

  // Tenta obter a data/hora de criação do registro a partir de chaves comuns
  function getCreatedAtAny(raw: any): Date | null {
    const r = raw || {}
    const keys = [
      'created_at','createdAt','inserted_at','insertedAt','created_on','createdOn','created','created_at_utc','createdAtUtc'
    ]
    for (const k of keys) {
      const v = r[k]
      if (v) { const d = new Date(v); if (!isNaN(d.getTime())) return d }
    }
    return null
  }

  // Converte Date -> texto do tipo "Há 39min" | "Há 3h" | "Há 2d"
  function formatAgo(from: Date | null): string {
    if (!from) return 'Há pouco'
    const diffMs = Date.now() - from.getTime()
    const mins = Math.floor(diffMs / 60000)
    if (mins < 1) return 'Agora'
    if (mins < 60) return `Há ${mins}min`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `Há ${hours}h`
    const days = Math.floor(hours / 24)
    return `Há ${days}d`
  }

  function openWhats(b: Booking) {
    const num = normalizePhoneForWhats(b.phone)
    if (!num) { alert('Telefone inválido ou ausente neste agendamento.'); return }
    const text = buildWhatsMessage(b)
    const url = `https://wa.me/${num}?text=${encodeURIComponent(text)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      if (!barberId) {
        setItems([])
        setEstimated(0)
        setCompletedTotal(0)
        setPendingCount(0)
        setDoneCount(0)
        setAgendarCount(0)
        setCancelarCount(0)
        return
      }
      const supa = getSupabase()
      const cols = await getBookingColumns(supa)
      const sch = await getBookingSchema(supa)
      setSchema(sch)
  // Garante um intervalo válido (ordena caso o usuário inverta)
  const from = (startDate && endDate && startDate > endDate) ? endDate : startDate
  const to = (startDate && endDate && startDate > endDate) ? startDate : endDate
      const { data, error } = await supa
        .from('bookings')
        .select(`id, ${cols.dateCol}, ${cols.timeCol}, name, phone, service, price, duration_minutes${sch.statusKind==='text' && sch.statusCol ? `, ${sch.statusCol}` : ''}${sch.statusKind==='boolean' && sch.isCompletedCol ? `, ${sch.isCompletedCol}` : ''}${sch.completedAtCol ? `, ${sch.completedAtCol}` : ''}${sch.servicesJsonCol ? `, ${sch.servicesJsonCol}` : ''}${(sch as any).servicesCol ? `, ${(sch as any).servicesCol}` : ''}`)
        .gte(cols.dateCol, from)
        .lte(cols.dateCol, to)
        .eq('barber_id', barberId)
      if (error) throw error
      const mapped = ((data as any[]) || []).map(d => ({
        id: String(d.id),
        date: d[cols.dateCol],
        time: d[cols.timeCol],
        name: d.name,
        phone: d.phone,
        service: d.service,
        price: d.price,
        durationMinutes: d.duration_minutes,
        _raw: d
      })) as Booking[]
      const sumAll = mapped.reduce((s, it:any)=> s + (typeof it.price==='number' ? it.price : 0), 0)
      const isDone = (it:any) => {
        if (sch.statusKind==='boolean' && sch.isCompletedCol) return !!it._raw[sch.isCompletedCol]
        if (sch.statusKind==='text' && sch.statusCol) {
          const v = (it._raw[sch.statusCol] || '').toLowerCase()
          return (v==='concluido' || v==='concluído' || v==='concluida' || v==='concluída' || v==='fechado' || v==='finalizado')
        }
        return false
      }
      const isAgendar = (it:any) => {
        if (sch.statusKind==='text' && sch.statusCol) {
          const v = String(it._raw[sch.statusCol]||'').toLowerCase()
          if (v === 'agendar') return true
        }
        const svc = String(it.service || '')
        return /^\s*agendar\s*:/i.test(svc)
      }
      const isCancelar = (it:any) => {
        if (sch.statusKind==='text' && sch.statusCol) {
          const v = String(it._raw[sch.statusCol]||'').toLowerCase()
          if (v === 'cancelar') return true
        }
        const svc = String(it.service || '')
        return /^\s*cancelar\s*:/i.test(svc)
      }
      mapped.sort((a,b)=> {
        if (a.date === b.date) return a.time < b.time ? -1 : a.time > b.time ? 1 : 0
        return a.date < b.date ? -1 : 1
      })
    const sumCompleted = mapped.reduce((s, it:any)=> s + (isDone(it) && typeof it.price==='number' ? it.price : 0), 0)
    const agendar = mapped.filter((it:any)=> isAgendar(it)).length
    const cancelar = mapped.filter((it:any)=> isCancelar(it)).length
    const pend = mapped.filter((it:any)=> !isDone(it) && !isAgendar(it) && !isCancelar(it)).length
      const done = mapped.length - pend
      setEstimated(sumAll)
      setCompletedTotal(sumCompleted)
    setAgendarCount(agendar)
      setCancelarCount(cancelar)
      setPendingCount(pend)
      setDoneCount(done)
      setItems(mapped)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Falha ao carregar agendamentos')
      setItems([])
    } finally {
      setLoading(false)
      signalHydrated()
    }
  }, [startDate, endDate, barberId, signalHydrated])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    let active = true
    const supa = getSupabase()
    const ch = supa
      .channel(`range-${startDate}-${endDate}-${barberId ?? 'none'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: barberId ? `barber_id=eq.${barberId}` : 'barber_id=eq.__none__' }, () => {
        if (!active) return
        void load()
      })
      .subscribe()
    return () => { active = false; getSupabase().removeChannel(ch) }
  }, [startDate, endDate, barberId, load])

  async function cancel(id: string) {
    if (!confirm('Cancelar este agendamento?')) return
    try {
      setActingId(id)
      const { error } = await getSupabase().from('bookings').delete().eq('id', id).eq('barber_id', barberId ?? '')
      if (error) {
        alert('Falha ao excluir: ' + (error.message || 'erro desconhecido'))
        return
      }
      // Atualiza imediatamente a lista
      setItems(prev => prev.filter((b:any) => b.id !== id))
      // Recarrega a página para garantir sincronização total do painel
      window.location.reload()
    } finally {
      setActingId(null)
    }
  }

  async function conclude(id: string) {
    if (!confirm('Concluir este serviço?')) return
    setActingId(id)
    const supa = getSupabase()
    const sch = schema || await getBookingSchema(supa)
    try {
      let update: any | null = null
      if (sch.statusKind==='boolean' && sch.isCompletedCol) {
        update = { [sch.isCompletedCol]: true, ...(sch.completedAtCol ? { [sch.completedAtCol]: new Date().toISOString() } : {}) }
      } else if (sch.statusKind==='text' && sch.statusCol) {
        update = { [sch.statusCol]: 'concluido', ...(sch.completedAtCol ? { [sch.completedAtCol]: new Date().toISOString() } : {}) }
      }
      if (!update) { alert('Para concluir, crie a coluna is_completed (boolean) ou status (text).'); return }
      const { error, data } = await supa
        .from('bookings')
        .update(update)
        .eq('id', id)
        .eq('barber_id', barberId ?? '')
        .select('id')
        .limit(1)
      if (error) { alert('Falha ao concluir: ' + (error.message || 'erro desconhecido')); return }
      if (Array.isArray(data) && data.length > 0 && (data[0] as any)?.id) {
        setItems(prev => prev.map((p:any) => {
          if (p.id !== id) return p
          const copy:any = { ...p }
          if (sch.statusKind==='boolean' && sch.isCompletedCol) {
            copy._raw = { ...(copy._raw||{}), [sch.isCompletedCol]: true, ...(sch.completedAtCol ? { [sch.completedAtCol]: new Date().toISOString() } : {}) }
          } else if (sch.statusKind==='text' && sch.statusCol) {
            copy._raw = { ...(copy._raw||{}), [sch.statusCol]: 'concluido', ...(sch.completedAtCol ? { [sch.completedAtCol]: new Date().toISOString() } : {}) }
          }
          return copy
        }))
        void load()
      } else {
        alert('Nenhum registro foi alterado ao concluir. Verifique o ID do agendamento ou as políticas de acesso (RLS).')
      }
    } finally {
      setActingId(null)
    }
  }

  return (
    <div className="grid gap-4">
      {/* Período */}
      <div>
        <h4 className="text-sm text-neutral-300 mb-2">Período</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col">
            <label className="text-xs font-medium text-neutral-400 mb-1">Data inicial</label>
            <input
              type="date"
              className="w-full bg-neutral-900 border border-neutral-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition"
              value={startDate}
              max={endDate || undefined}
              onChange={(e)=> {
                const v = e.target.value
                if (!v) return
                setStartDate(v)
                if (endDate && v > endDate) setEndDate(v)
              }}
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs font-medium text-neutral-400 mb-1">Data final</label>
            <input
              type="date"
              className="w-full bg-neutral-900 border border-neutral-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition"
              value={endDate}
              min={startDate || undefined}
              onChange={(e)=> {
                const v = e.target.value
                if (!v) return
                setEndDate(v)
                if (startDate && v < startDate) setStartDate(v)
              }}
            />
          </div>
        </div>
      </div>

      {/* Mostrar concluídos */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-neutral-400">Mostrar concluídos</span>
        <button type="button" onClick={()=>setShowCompleted(v=>!v)} className={`w-12 h-7 rounded-full border border-neutral-700 relative transition-colors ${showCompleted ? 'bg-emerald-600/40' : 'bg-neutral-800'}`} aria-pressed={showCompleted}>
          <span className={`absolute top-1 left-1 h-5 w-5 rounded-full bg-white transition-all ${showCompleted ? 'translate-x-5' : ''}`}></span>
        </button>
      </div>

      {/* Cards centralizados dentro do container */}
      <div className="w-full max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard title="Agendamentos (período)" value={String(items.length)} />
        <StatCard title="Receita Estimada (período)" value={`R$ ${estimated.toFixed(2)}`} />
        <StatCard title="Receita Adquirida (período)" value={`R$ ${completedTotal.toFixed(2)}`} />
      </div>

      {/* Botão Lançar Avulso (full width do container cinza) */}
      <div className="w-full max-w-3xl mx-auto">
        <button
          type="button"
          onClick={() => { setAvulsoOpen(true); setAvulsoName(''); setAvulsoDate(new Date().toISOString().slice(0,10)); setAvulsoSelectedIds([]) }}
          className="w-full mt-2 h-11 rounded-lg bg-neutral-950 hover:bg-emerald-500 text-white font-stretch-90 shadow border border-neutral-500/50"
        >Incluir Avulso
        </button>
        <button
          type="button"
          onClick={() => { setBlockOpen(true); setBlockDate(new Date().toISOString().slice(0,10)); setBlockStart(''); setBlockEnd('') }}
          className="w-full mt-2 h-11 rounded-lg bg-neutral-950 hover:bg-red-500 text-white font-stretch-90 shadow border border-neutral-500/50"
        >Bloquear Horários
        </button>
      </div>

      <div className="flex items-center gap-2 mt-2">
        <span className="px-2.5 py-1 rounded-full text-xs bg-red-500/15 text-red-300 border border-red-400/40 animate-pulse">Agendar: {agendarCount}</span>
        <span className="px-2.5 py-1 rounded-full text-xs bg-yellow-500/10 text-yellow-400 border border-yellow-500/30">Pendentes: {pendingCount}</span>
        <span className="px-2.5 py-1 rounded-full text-xs bg-blue-500/10 text-blue-400 border border-blue-500/30">Concluídos: {doneCount}</span>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className="px-2.5 py-1 rounded-full text-xs bg-red-500/15 text-red-300 border border-red-400/40 animate-pulse">Cancelar: {cancelarCount}</span>
      </div>

      {loading && (<div className="text-sm text-neutral-400">Carregando...</div>)}
      {err && (<div className="text-sm text-red-400">{err}</div>)}

      {/* Área rolável horizontal para evitar corte de conteúdo em nomes/serviços longos */}
      <div className="overflow-x-auto pb-1" role="region" aria-label="Lista de agendamentos" tabIndex={0}>
        <div className="grid gap-2 w-max min-w-full">
        {items.filter((b:any)=>{
          if (!schema) return true
          const d = (b as any)._raw || {}
          if (schema.statusKind==='boolean' && schema.isCompletedCol) return showCompleted ? true : !d[schema.isCompletedCol]
          if (schema.statusKind==='text' && schema.statusCol) {
            const v = (d[schema.statusCol] || '').toLowerCase()
            const done = (v==='concluido' || v==='concluído' || v==='concluida' || v==='concluída' || v==='fechado' || v==='finalizado')
            return showCompleted ? true : !done
          }
          return showCompleted ? true : true
        }).map((b:any) => {
          const d = (b as any)._raw || {}
          const isDone = schema && (
            (schema.statusKind==='boolean' && schema.isCompletedCol && !!d[schema.isCompletedCol]) ||
            (schema.statusKind==='text' && schema.statusCol && ['concluido','concluído','concluida','concluída','fechado','finalizado'].includes(String(d[schema.statusCol]||'').toLowerCase()))
          )
          const isAgendar = (() => {
            if (schema && schema.statusKind==='text' && schema.statusCol) {
              const v = String(d[schema.statusCol]||'').toLowerCase()
              if (v === 'agendar') return true
            }
            const svc = String(b.service || '')
            return /^\s*agendar\s*:/i.test(svc)
          })()
          // Detecta solicitação de cancelamento: status 'cancelar' (text) ou service começando com 'CANCELAR:'
          const isCancelarReq = (() => {
            if (schema && schema.statusKind==='text' && schema.statusCol) {
              const v = String(d[schema.statusCol]||'').toLowerCase()
              if (v === 'cancelar') return true
            }
            const svc = String(b.service || '')
            return /^\s*cancelar\s*:/i.test(svc)
          })()
          // Detecta registro Avulso: status 'avulso' (text) ou service começando com 'AVULSO:'
          const isAvulso = (() => {
            if (schema && schema.statusKind==='text' && schema.statusCol) {
              const v = String(d[schema.statusCol]||'').toLowerCase()
              if (v === 'avulso') return true
            }
            const svc = String(b.service || '')
            return /^\s*avulso\s*:/i.test(svc)
          })()
          // Detecta bloqueio: status 'bloqueado' (text) ou service começando com 'BLOQUEIO:'
          const isBlocked = (() => {
            if (schema && schema.statusKind==='text' && schema.statusCol) {
              const v = String(d[schema.statusCol]||'').toLowerCase()
              if (v === 'bloqueado') return true
            }
            const svc = String(b.service || '')
            return /^\s*bloqueio\s*:/i.test(svc)
          })()
          // Título e subtítulo exibidos
          const displayTitle = isBlocked ? 'Intervalo de Horários Bloqueados' : b.name
          const displaySubtitle = (() => {
            if (!isBlocked) {
              const names = getServiceNames(d, b)
              if (names.length > 0) return names.join(', ')
              const s = (b.service ? String(b.service).replace(/^\s*(AGENDAR|AVULSO)\s*:\s*/i, '').trim() : 'Sem serviço')
              if (/^\d+\s+servi[cç]os?$/i.test(s)) return 'Sem serviço'
              return s
            }
            // Para bloqueados, tenta extrair intervalo do campo service
            const svc = String(b.service||'')
            const m = svc.match(/BLOQUEIO\s*:\s*([^\n]+)/i)
            if (m && m[1]) return m[1].trim()
            // fallback: calcula pelo início + duração
            const toHHmm = (t:string) => {
              const s = String(t||'').trim()
              if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) { const [h,m] = s.split(':'); return `${String(h).padStart(2,'0')}:${m}` }
              if (/^\d{4}$/.test(s)) return `${s.slice(0,2)}:${s.slice(2)}`
              if (/^\d{1,2}$/.test(s)) return `${String(Number(s)).padStart(2,'0')}:00`
              return s
            }
            const start = toHHmm(b.time)
            const mins = Math.max(0, Number(b.durationMinutes||0))
            if (!mins) return start
            const [hh,mm] = start.split(':').map(Number)
            const total = hh*60 + mm + mins
            const end = `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`
            return `${start}–${end}`
          })()
          return (
            <div key={b.id} role="button" tabIndex={0} onClick={()=>setSelected(b)} onKeyDown={(e)=>{ if(e.key==='Enter' || e.key===' ') { e.preventDefault(); setSelected(b) } }} className={`group w-full text-left flex items-center gap-3 bg-neutral-950 hover:bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-lg px-3 py-2 transition ${isDone ? 'opacity-90' : ''}`}>
              <span className="shrink-0 inline-flex items-center justify-center w-16 h-10 rounded-md bg-neutral-800 text-neutral-200 font-semibold">{displayTime(b.time)}</span>
              <span className="flex-1 min-w-0">
                <span className="block font-medium text-white truncate">{displayTitle}</span>
                <span className="block text-xs text-neutral-400 whitespace-normal break-words">{displaySubtitle}</span>
              </span>
              {isBlocked ? (
                <span className="px-2 py-1 rounded-full text-[11px] bg-red-500/15 text-red-300 border border-red-400/40">Bloqueado</span>
              ) : isAvulso ? (
                <span className="px-2 py-1 rounded-full text-[11px] bg-purple-500/15 text-purple-300 border border-purple-400/40">Avulso</span>
              ) : isAgendar ? (
                <span className="px-2 py-1 rounded-full text-[11px] bg-red-500/15 text-red-300 border border-red-400/40 animate-pulse">Agendar</span>
              ) : isCancelarReq ? (
                <span className="px-2 py-1 rounded-full text-[11px] bg-red-500/15 text-red-300 border border-red-400/40 animate-pulse">Cancelar</span>
              ) : isDone ? (
                <span className="px-2 py-1 rounded-full text-[11px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">Concluído</span>
              ) : (
                isBlocked ? (
                  <div className="flex flex-col gap-1 items-stretch ml-1">
                    <button onClick={(e)=>{ e.stopPropagation(); cancel(b.id) }} disabled={actingId===b.id} className="px-2 py-1 rounded bg-red-600 text-sm disabled:opacity-60">Cancelar</button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 items-stretch ml-1">
                    {schema?.statusKind==='text' && schema.statusCol && (
                      <button
                        onClick={async (e)=>{
                          e.stopPropagation();
                          setActingId(b.id);
                          const field = schema.statusCol as string;
                          const update:any = {}; update[field] = null;
                          await getSupabase().from('bookings').update(update).eq('id', b.id).eq('barber_id', barberId ?? '');
                          setActingId(null);
                          void load();
                        }}
                        disabled={actingId===b.id}
                        className="px-2 py-1 rounded bg-amber-400 text-black text-sm font-semibold disabled:opacity-60"
                      >Marcar como Pendente</button>
                    )}
                    <button onClick={(e)=>{ e.stopPropagation(); conclude(b.id) }} disabled={actingId===b.id} className="px-2 py-1 rounded bg-blue-700 text-black text-sm font-semibold disabled:opacity-60">Concluir</button>
                    <button onClick={(e)=>{ e.stopPropagation(); cancel(b.id) }} disabled={actingId===b.id} className="px-2 py-1 rounded bg-red-600 text-sm disabled:opacity-60">Cancelar</button>
                  </div>
                )
              )}
            </div>
          )
        })}
        {items.length===0 && !loading && !err && (
          <p className="text-sm text-neutral-400">Nenhum agendamento neste período.</p>
        )}
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={()=>setSelected(null)}>
          <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-5 shadow-xl" onClick={(e)=>e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-white">{selected.name}</h3>
                <p className="text-sm text-neutral-400">{(() => { const d=(selected as any)._raw||{}; const names = getServiceNames(d, selected); if (names.length) return names.join(', '); const s=selected.service? String(selected.service).replace(/^\s*AGENDAR\s*:\s*/i, '').trim() : 'Sem serviço'; return /^\d+\s+servi[cç]os?$/i.test(s) ? 'Sem serviço' : s })()} • {displayTime(selected.time)} • {selected.date}</p>
              </div>
              <button onClick={()=>setSelected(null)} className="px-2 py-1 rounded bg-neutral-800 border border-neutral-700">Fechar</button>
            </div>
            <div className="mt-4 grid gap-2 text-sm">
              {(() => { const d=(selected as any)._raw||{}; const arrNames = getServiceNames(d, selected); if (Array.isArray(arrNames) && arrNames.length>0) { return (
                <div>
                  <span className="text-neutral-400">Serviços</span>
                  <ul className="mt-1 list-disc list-inside text-neutral-200">
                    {arrNames.map((name:string, idx:number)=> <li key={idx}>{name}</li>)}
                  </ul>
                </div>
              ) } else { const s=selected?.service ? String(selected.service) : ''; if (s && !/^\d+\s+servi[cç]os?$/i.test(s)) { return (
                <div>
                  <span className="text-neutral-400">Serviço</span>
                  <div className="mt-1 text-neutral-200">{s}</div>
                </div>
              ) } return null } })()}
              <div className="flex justify-between"><span className="text-neutral-400">Whatsapp</span><span className="text-neutral-200">{selected.phone || '—'}</span></div>
              <div className="flex justify-between"><span className="text-neutral-400">Preço</span><span className="text-neutral-200">{typeof selected.price==='number' ? `R$ ${selected.price.toFixed(2)}` : '—'}</span></div>
              <div className="flex justify-between"><span className="text-neutral-400">Duração</span><span className="text-neutral-200">{selected.durationMinutes || 0} min</span></div>
              <div className="flex justify-between"><span className="text-neutral-400">Data</span><span className="text-neutral-200">{selected.date}</span></div>
              <div className="flex justify-between"><span className="text-neutral-400">Status</span><span className="text-neutral-200">{(() => { const d = (selected as any)._raw || {}; if (schema?.statusKind==='boolean' && schema.isCompletedCol) return d[schema.isCompletedCol] ? 'Concluído' : 'Pendente'; if (schema?.statusKind==='text' && schema.statusCol) { const v = String(d[schema.statusCol]||'').toLowerCase(); if (v==='bloqueado') return 'Bloqueado'; return ['concluido','concluído','concluida','concluída','fechado','finalizado'].includes(v) ? 'Concluído' : 'Pendente'; } return '—' })()}</span></div>
              {schema?.completedAtCol && (
                <div className="flex justify-between"><span className="text-neutral-400">Concluído em</span><span className="text-neutral-200">{(() => { const d=(selected as any)._raw||{}; const c=d[schema.completedAtCol]; return c ? new Date(c).toLocaleString() : '—' })()}</span></div>
              )}
            </div>
            <div className="mt-5 flex flex-wrap justify-center gap-3 items-stretch">
              <button
                onClick={async ()=>{ await generatePdfForBooking(selected) }}
                className="h-10 px-4 min-w-[150px] rounded-md bg-amber-600 text-black font-semibold shadow-sm border border-amber-500/40 hover:bg-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-300/50 transition"
              >Comprovante PDF</button>
              <button
                onClick={()=> selected && openWhats(selected as Booking)}
                disabled={!normalizePhoneForWhats((selected as Booking | null)?.phone)}
                className="h-10 px-4 min-w-[130px] rounded-md bg-[#25D366] text-black font-semibold inline-flex items-center justify-center gap-2 shadow-sm hover:brightness-95 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-emerald-300/50 transition"
                title={normalizePhoneForWhats((selected as Booking | null)?.phone) ? 'Abrir WhatsApp' : 'Telefone ausente ou inválido'}
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
                  <path fill="currentColor" d="M2 21l1.6-5.8A9 9 0 1112 21a9.4 9.4 0 01-4.6-1.2L2 21zm6.7-6.9c2.1 2.1 3.8 2.7 4.5 2.9.7.2 1.2-.1 1.5-.6.3-.5.6-1.1.4-1.3-.2-.2-.8-.4-1.6-.8-.8-.4-.9-.5-1.3.1-.4.5-.6.6-1.1.4-.5-.2-1.9-.9-3-2s-1.8-2.5-2-3c-.2-.5 0-.7.4-1.1.6-.4.5-.5.1-1.3-.4-.8-.6-1.4-.8-1.6-.2-.2-.8.1-1.3.4-.5.3-.8.8-.6 1.5.2.7.8 2.4 2.9 4.5z"/>
                </svg>
                Whats
              </button>
              {(() => {
                const d=(selected as any)._raw||{}
                const done = schema ? ((schema.statusKind==='boolean' && schema.isCompletedCol && !!d[schema.isCompletedCol]) || (schema.statusKind==='text' && schema.statusCol && ['concluido','concluído','concluida','concluída','fechado','finalizado'].includes(String(d[schema.statusCol]||'').toLowerCase()))) : false
                // Quando já estiver concluído, ainda permitir Cancelar (excluir) o agendamento
                if (done) return (
                  <button
                    onClick={async ()=>{ await cancel(selected.id); setSelected(null) }}
                    disabled={actingId===selected?.id}
                    className="h-10 px-4 min-w-[130px] rounded-md bg-red-600 text-white font-semibold shadow-sm hover:brightness-95 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-red-300/50 transition"
                  >Cancelar</button>
                )
                // Solicitação de cancelamento: aceitar (excluir) ou rejeitar (reverter status/prefixo)
                const isCancelarSel = (() => {
                  if (schema?.statusKind==='text' && schema.statusCol) { const v = String(d[schema.statusCol]||'').toLowerCase(); if (v==='cancelar') return true }
                  const svc = String((selected as any).service || '')
                  return /^\s*cancelar\s*:/i.test(svc)
                })()
                if (isCancelarSel) {
                  return (
                    <>
                      <button
                        onClick={async ()=>{ await cancel(selected.id); setSelected(null) }}
                        disabled={actingId===selected?.id}
                        className="h-10 px-4 min-w-[170px] rounded-md bg-red-600 text-white font-semibold shadow-sm hover:brightness-95 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-red-300/50 transition"
                      >Aceitar Cancelamento</button>
                      <button
                        onClick={async ()=>{
                          if (!schema) return
                          setActingId(selected.id)
                          try {
                            const supa = getSupabase()
                            if (schema.statusKind==='text' && schema.statusCol) {
                              const update:any = {}; update[schema.statusCol] = null
                              await supa.from('bookings').update(update).eq('id', selected.id).eq('barber_id', barberId ?? '')
                            } else {
                              const cur = String((selected as any).service||'')
                              const next = cur.replace(/^\s*CANCELAR\s*:\s*/i, '')
                              await supa.from('bookings').update({ service: next }).eq('id', selected.id).eq('barber_id', barberId ?? '')
                            }
                            setSelected(null)
                            void load()
                          } finally { setActingId(null) }
                        }}
                        disabled={actingId===selected?.id}
                        className="h-10 px-4 min-w-[170px] rounded-md bg-neutral-800 text-white font-semibold shadow-sm hover:brightness-95 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-neutral-300/50 transition"
                      >Cancelar Solicitação</button>
                    </>
                  )
                }
                const isAgendarSel = (() => {
                  if (schema?.statusKind==='text' && schema.statusCol) {
                    const v = String(d[schema.statusCol]||'').toLowerCase(); if (v==='agendar') return true
                  }
                  const svc = String((selected as any).service || '')
                  return /^\s*agendar\s*:/i.test(svc)
                })()
                if (isAgendarSel) {
                  return (
                    <>
                      <select
                        aria-label="Alterar status"
                        className="h-9 bg-neutral-800 border border-neutral-700 text-white text-sm rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                        value="agendar"
                        disabled={actingId===selected?.id}
                        onChange={async (e)=>{
                          const next = e.target.value
                          if (next !== 'pendente') return
                          setActingId(selected.id)
                          const supa = getSupabase()
                          const sch = schema || await getBookingSchema(supa)
                          try {
                            let update: any = {}
                            if (sch.statusKind==='text' && sch.statusCol) {
                              update[sch.statusCol] = 'pendente'
                            } else {
                              const current = String((selected as any).service || '')
                              const nextService = current.replace(/^\s*AGENDAR\s*:\s*/i, '')
                              update['service'] = nextService
                            }
                            const { error } = await supa.from('bookings').update(update).eq('id', selected.id).eq('barber_id', barberId ?? '')
                            if (error) { alert('Falha ao atualizar: ' + (error.message || 'erro desconhecido')); return }
                            setSelected(null)
                            void load()
                          } finally {
                            setActingId(null)
                          }
                        }}
                      >
                        <option value="agendar">Agendar</option>
                        <option value="pendente">Pendente</option>
                      </select>
                      <button onClick={async ()=>{ await cancel(selected.id); setSelected(null) }} disabled={actingId===selected?.id} className="h-10 px-4 min-w-[130px] rounded-md bg-red-600 text-white font-semibold shadow-sm hover:brightness-95 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-red-300/50 transition">Cancelar</button>
                    </>
                  )
                }
                return (
                  <>
                    <button onClick={async ()=>{ await conclude(selected.id); setSelected(null) }} disabled={actingId===selected?.id} className="h-10 px-4 min-w-[130px] rounded-md bg-blue-500 text-black font-semibold shadow-sm hover:brightness-95 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-blue-300/50 transition">Concluir</button>
                    <button onClick={async ()=>{ await cancel(selected.id); setSelected(null) }} disabled={actingId===selected?.id} className="h-10 px-4 min-w-[130px] rounded-md bg-red-600 text-white font-semibold shadow-sm hover:brightness-95 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-red-300/50 transition">Cancelar</button>
                  </>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Modal Lançar Avulso */}
      {avulsoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={()=> setAvulsoOpen(false)}>
          <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-5 shadow-xl" onClick={(e)=> e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-lg font-semibold">Incluir Avulso</h3>
              <button onClick={()=> setAvulsoOpen(false)} className="px-2 py-1 rounded bg-neutral-800 border border-neutral-700">Fechar</button>
            </div>
            <div className="grid gap-3">
              <div>
                <label className="text-xs text-neutral-300">Nome do cliente</label>
                <input value={avulsoName} onChange={e=>setAvulsoName(e.target.value)} placeholder="Digite o nome" className="w-full mt-1 bg-neutral-950 border border-neutral-800 rounded px-3 py-2" />
              </div>
              <div>
                <label className="text-xs text-neutral-300">Data</label>
                <input type="date" value={avulsoDate} max={new Date().toISOString().slice(0,10)} onChange={e=> setAvulsoDate(e.target.value)} className="w-full mt-1 bg-neutral-950 border border-neutral-800 rounded px-3 py-2" />
              </div>
              <div>
                <label className="text-xs text-neutral-300">Serviços realizados</label>
                <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-auto pr-1">
                  {avulsoServices.map(s => {
                    const active = avulsoSelectedIds.includes(s.id)
                    return (
                      <button key={s.id} type="button" onClick={()=> setAvulsoSelectedIds(prev=> prev.includes(s.id)? prev.filter(x=>x!==s.id) : [...prev, s.id])} className={`text-left rounded-md border px-2 py-2 text-sm transition ${active? 'border-purple-500 bg-purple-500/15 text-purple-200' : 'border-neutral-800 bg-neutral-950 hover:bg-neutral-900'}`}>
                        <span className="block font-medium truncate">{s.title}</span>
                        <span className="block text-[11px] opacity-75">{s.minutes} min • R$ {s.price.toFixed(2)}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-neutral-300 mt-1">
                <span>Selecionados: {avulsoSelectedIds.length}</span>
                <span>
                  {(() => { const arr = avulsoServices.filter(s=> avulsoSelectedIds.includes(s.id)); const price = arr.reduce((a,s)=> a + (s.price||0), 0); return `Total: R$ ${price.toFixed(2)}` })()}
                </span>
              </div>
              <button
                onClick={async ()=>{
                  if (!avulsoName.trim()) { alert('Informe o nome do cliente.'); return }
                  const sel = avulsoServices.filter(s=> avulsoSelectedIds.includes(s.id))
                  if (sel.length === 0) { alert('Selecione pelo menos um serviço.'); return }
                  setAvulsoSaving(true)
                  try {
                    const supa = getSupabase()
                    const cols = await getBookingColumns(supa)
                    const sch = await getBookingSchema(supa)
                    // Utilitários locais para evitar colisão de horário (unique slot)
                    const toMinutes = (t:string): number => {
                      const s = String(t||'').trim()
                      const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
                      if (m) { const hh = Math.min(23, Math.max(0, parseInt(m[1],10)||0)); const mm = Math.min(59, Math.max(0, parseInt(m[2],10)||0)); return hh*60+mm }
                      if (/^\d{4}$/.test(s)) { const hh = parseInt(s.slice(0,2),10)||0; const mm = parseInt(s.slice(2),10)||0; return Math.min(23,Math.max(0,hh))*60 + Math.min(59,Math.max(0,mm)) }
                      if (/^\d{1,2}$/.test(s)) { const hh = parseInt(s,10)||0; return Math.min(23,Math.max(0,hh))*60 }
                      return 0
                    }
                    const toHHmm = (m:number) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
                    const pickAvailableEODTime = async (targetDate:string): Promise<string> => {
                      const { data } = await supa.from('bookings').select(cols.timeCol).eq(cols.dateCol, targetDate).eq('barber_id', barberId ?? '')
                      const used = new Set<number>((data||[]).map((r:any)=> toMinutes(r[cols.timeCol])))
                      // Tenta do 23:59 descendo até 20:00 (ou mais, se necessário)
                      for (let m=23*60+59; m>=0; m--) {
                        if (!used.has(m)) return toHHmm(m)
                      }
                      // fallback improvável
                      return '23:59'
                    }
                    // Monta um registro marcado como concluído e AVULSO
                    const titles = sel.map(s=> s.title)
                    const price = sel.reduce((a,s)=> a + (s.price||0), 0)
                    const minutes = sel.reduce((a,s)=> a + (s.minutes||0), 0)
                    const payload:any = { name: avulsoName.trim(), phone: null, service: `AVULSO: ${titles.join(', ')}`, price, duration_minutes: minutes, barber_id: barberId }
                    payload[cols.dateCol] = avulsoDate
                    // horário EOD único para evitar violação de chave única
                    payload[cols.timeCol] = await pickAvailableEODTime(avulsoDate)
                    // Preferir services_json quando existir
                    if (sch.servicesJsonCol) payload[sch.servicesJsonCol] = sel.map(s=> ({ id: s.id, title: s.title, price: s.price, minutes: s.minutes }))
                    // Marca como concluído numa das colunas de status, se houver
                    if (sch.statusKind==='boolean' && sch.isCompletedCol) payload[sch.isCompletedCol] = true
                    if (sch.statusKind==='text' && sch.statusCol) payload[sch.statusCol] = 'avulso'
                    if (sch.completedAtCol) payload[sch.completedAtCol] = new Date().toISOString()
                    let { error } = await supa.from('bookings').insert([payload])
                    // Em caso de conflito (duplicidade), tenta mais uma vez com outro horário
                    if (error && (error as any)?.code === '23505') {
                      payload[cols.timeCol] = await pickAvailableEODTime(avulsoDate)
                      const retry = await supa.from('bookings').insert([payload])
                      error = retry.error as any
                    }
                    if (error) throw error
                    // Notificação de sucesso com detalhes
                    setAvulsoOpen(false)
                    setAvulsoSelectedIds([])
                    setAvulsoConfirm({ name: avulsoName.trim(), date: avulsoDate, items: sel, totalPrice: price, totalMinutes: minutes })
                    void load()
                  } catch(e:any) {
                    alert('Falha ao lançar avulso: ' + (e?.message || 'erro desconhecido'))
                  } finally { setAvulsoSaving(false) }
                }}
                disabled={avulsoSaving}
                className="h-10 rounded-md bg-purple-500/15 text-white font-semibold hover:brightness-95 disabled:opacity-60"
              >{avulsoSaving? 'Lançando...' : 'Lançar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Bloquear Horários */}
      {blockOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={()=> setBlockOpen(false)}>
          <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-5 shadow-xl" onClick={(e)=> e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-lg font-semibold">Bloquear Horários</h3>
              <button onClick={()=> setBlockOpen(false)} className="px-2 py-1 rounded bg-neutral-800 border border-neutral-700">Fechar</button>
            </div>
            <div className="grid gap-3">
              <div>
                <label className="text-xs text-neutral-300">Data</label>
                <input type="date" value={blockDate} onChange={e=> setBlockDate(e.target.value)} className="w-full mt-1 bg-neutral-950 border border-neutral-800 rounded px-3 py-2" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-neutral-300">Início</label>
                  <input type="time" value={blockStart} onChange={e=> setBlockStart(e.target.value)} className="w-full mt-1 bg-neutral-950 border border-neutral-800 rounded px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-neutral-300">Fim</label>
                  <input type="time" value={blockEnd} onChange={e=> setBlockEnd(e.target.value)} className="w-full mt-1 bg-neutral-950 border border-neutral-800 rounded px-3 py-2" />
                </div>
              </div>
              <button
                onClick={async ()=>{
                  const toHHmm = (t:string) => {
                    const s = String(t||'').trim()
                    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) { const [h,m] = s.split(':'); return `${String(h).padStart(2,'0')}:${m}` }
                    if (/^\d{4}$/.test(s)) return `${s.slice(0,2)}:${s.slice(2)}`
                    if (/^\d{1,2}$/.test(s)) return `${String(Number(s)).padStart(2,'0')}:00`
                    return s
                  }
                  const toMinutes = (t:string): number => {
                    const s = toHHmm(t)
                    const [hh,mm] = s.split(':').map(v=>parseInt(v||'0',10))
                    return Math.max(0, Math.min(23,hh))*60 + Math.max(0, Math.min(59,mm))
                  }
                  const startStr = toHHmm(blockStart)
                  const endStr = toHHmm(blockEnd)
                  if (!blockDate || !startStr || !endStr || !/^\d{2}:\d{2}$/.test(startStr) || !/^\d{2}:\d{2}$/.test(endStr)) { alert('Preencha data, início e fim.'); return }
                  const startMin = toMinutes(startStr)
                  const endMin = toMinutes(endStr)
                  if (endMin <= startMin) { alert('O horário final deve ser maior que o inicial.'); return }
                  const duration = endMin - startMin
                  setBlockSaving(true)
                  try {
                    const supa = getSupabase()
                    const cols = await getBookingColumns(supa)
                    const sch = await getBookingSchema(supa)
                    // Tenta o horário exato do início, se conflitar escolhe o próximo minuto disponível dentro do intervalo
                    const pickAvailableInRange = async (targetDate:string, fromMin:number, toMin:number): Promise<string | null> => {
                      const { data } = await supa.from('bookings').select(cols.timeCol).eq(cols.dateCol, targetDate).eq('barber_id', barberId ?? '')
                      const used = new Set<number>((data||[]).map((r:any)=> toMinutes(r[cols.timeCol])))
                      for (let m=fromMin; m<toMin; m++) { if (!used.has(m)) return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}` }
                      return null
                    }
                    const payload:any = { name: 'Bloqueio', phone: null, service: `BLOQUEIO: ${startStr}–${endStr}`, price: 0, duration_minutes: duration, barber_id: barberId }
                    payload[cols.dateCol] = blockDate
                    payload[cols.timeCol] = startStr
                    if (sch.statusKind==='text' && sch.statusCol) payload[sch.statusCol] = 'bloqueado'
                    // Tenta inserir
                    let { error } = await supa.from('bookings').insert([payload])
                    if (error && (error as any)?.code === '23505') {
                      const next = await pickAvailableInRange(blockDate, startMin, endMin)
                      if (!next) throw error
                      payload[cols.timeCol] = next
                      const retry = await supa.from('bookings').insert([payload])
                      error = retry.error as any
                    }
                    if (error) throw error
                    setBlockOpen(false)
                    setBlockConfirm({ date: blockDate, start: startStr, end: endStr })
                    void load()
                  } catch(e:any) {
                    alert('Falha ao bloquear horários: ' + (e?.message || 'erro desconhecido'))
                  } finally { setBlockSaving(false) }
                }}
                disabled={blockSaving}
                className="h-10 rounded-md bg-red-500/20 text-white font-semibold hover:brightness-95 disabled:opacity-60"
              >{blockSaving? 'Bloqueando...' : 'Bloquear'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmação de Lançamento Avulso */}
      {avulsoConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" role="alertdialog" aria-modal="true" aria-live="polite">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={()=>setAvulsoConfirm(null)} />
          <div className="relative w-full max-w-md rounded-2xl shadow-2xl border border-purple-500/40 bg-gradient-to-b from-purple-600/20 to-purple-800/10 text-purple-50">
            <div className="p-5">
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-purple-500/15 text-white shrink-0 shadow">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 16.2l-3.5-3.5L4 14.2 9 19l11-11-1.5-1.5L9 16.2z"/></svg>
                </div>
                <div className="flex-1">
                  <p className="text-base font-semibold">Lançamento Avulso concluído</p>
                  <p className="text-sm/6 opacity-90 mt-1">O registro foi lançado com sucesso e será refletido nos Agendamentos e nos Relatórios.</p>
                  <div className="mt-3 space-y-2 text-sm">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-purple-100/90">
                      <span><strong>Nome:</strong> {avulsoConfirm.name}</span>
                      <span><strong>Data:</strong> {(() => { const ds=avulsoConfirm.date; const m=/^\d{4}-\d{2}-\d{2}$/.test(ds)? ds.split('-'):null; return m? `${m[2]}/${m[1]}/${m[0]}` : ds })()}</span>
                    </div>
                    {avulsoConfirm.items.length>0 && (
                      <div>
                        <p className="font-medium text-purple-200 mb-1">Serviços:</p>
                        <ul className="list-disc list-inside space-y-0.5 text-purple-100/90 max-h-40 overflow-auto pr-1">
                          {avulsoConfirm.items.map((s, i) => (
                            <li key={i}>{s.title} • {s.minutes} min • R$ {Number(s.price||0).toFixed(2)}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="text-purple-100/90"><strong>Total:</strong> {avulsoConfirm.totalMinutes} min • R$ {Number(avulsoConfirm.totalPrice||0).toFixed(2)}</p>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <button onClick={()=>{ window.location.reload() }} className="px-4 py-2 rounded-md bg-purple-500 text-black font-semibold shadow hover:brightness-95">Ok</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmação de Bloqueio */}
      {blockConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" role="alertdialog" aria-modal="true" aria-live="polite">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={()=>setBlockConfirm(null)} />
          <div className="relative w-full max-w-md rounded-2xl shadow-2xl border border-red-500/40 bg-gradient-to-b from-red-600/20 to-red-800/10 text-red-50">
            <div className="p-5">
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-red-500/20 text-white shrink-0 shadow">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 1010 10A10.011 10.011 0 0012 2zm-1 15l-5-5 1.414-1.414L11 13.172l6.586-6.586L19 8z"/></svg>
                </div>
                <div className="flex-1">
                  <p className="text-base font-semibold">Bloqueio criado</p>
                  <p className="text-sm/6 opacity-90 mt-1">O intervalo foi bloqueado e ficará indisponível para novos agendamentos.</p>
                  <div className="mt-3 text-sm space-y-1">
                    <p><strong>Data:</strong> {(() => { const ds=blockConfirm.date; const m=/^\d{4}-\d{2}-\d{2}$/.test(ds)? ds.split('-'):null; return m? `${m[2]}/${m[1]}/${m[0]}` : ds })()}</p>
                    <p><strong>Intervalo:</strong> {blockConfirm.start} – {blockConfirm.end}</p>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <button onClick={()=>{ window.location.reload() }} className="px-4 py-2 rounded-md bg-red-500 text-black font-semibold shadow hover:brightness-95">Ok</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Ícone flutuante de notificações */}
      <div className="fixed bottom-5 right-5 z-40">
        <button
          type="button"
          aria-label={unreadCount>0?`Notificações: ${unreadCount} não lidas`:'Notificações'}
          onClick={() => setNotifOpen(o=>!o)}
          className="relative h-14 w-14 rounded-full bg-green-900 border border-neutral-800 shadow-lg shadow-black/40 hover:bg-neutral-800 transition-colors grid place-items-center focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
        >
          {/* Bell icon */}
          <svg viewBox="0 0 24 24" className="w-7 h-7 text-neutral-200" aria-hidden="true">
            <path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.5-2.5h-5A2.5 2.5 0 0 0 12 22Zm6.5-6V11a6.5 6.5 0 1 0-13 0v5L4 17v2h16v-2l-1.5-1Z"/>
          </svg>
          {unreadCount>0 && (
            <span className="absolute -top-1 -right-1 min-w-[24px] h-6 px-1 rounded-full bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center border-2 border-neutral-900">
              {unreadCount}
            </span>
          )}
        </button>
        {/* Painel */}
        {notifOpen && (
          <div className="absolute bottom-16 right-0 w-80 sm:w-96 max-h-[60vh] overflow-hidden rounded-xl border border-green-800 bg-green-950 shadow-2xl shadow-black/50">
            <div className="p-3 border-b border-green-800 flex items-center gap-2">
              <div className="flex-1">
                <p className="text-sm font-semibold text-white">Notificações</p>
                <p className="text-xs text-neutral-400">Agendamentos não lidos</p>
              </div>
              {unreadCount>0 && (
                <button onClick={markAllAsRead} className="text-xs px-2 py-1 rounded bg-emerald-600 text-black font-semibold hover:brightness-95">Marcar tudo lido</button>
              )}
            </div>
            <div className="max-h-[50vh] overflow-y-auto">
              {unreadItems.length === 0 ? (
                <div className="p-4 text-sm text-neutral-400">Nenhuma notificação por aqui.</div>
              ) : (
                <ul className="divide-y divide-neutral-800">
                  {unreadItems.map((b) => (
                    <li
                      key={b.id}
                      className="p-3 flex items-start gap-3 hover:bg-neutral-900/60 cursor-pointer"
                      role="button"
                      tabIndex={0}
                      onClick={() => openNotification(b)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNotification(b) } }}
                    >
                      <div className="shrink-0 h-9 rounded-md bg-neutral-800 text-neutral-100 font-semibold grid place-items-center px-2 whitespace-nowrap text-[11px]">
                        {formatAgo(getCreatedAtAny((b as any)._raw))}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-white truncate">{b.name || 'Cliente'}</p>
                        <p className="text-xs text-neutral-400">{formatDatePtFull(b.date)} • {displayTime(b.time)}</p>
                      </div>
                      <div className="shrink-0">
                        <button onClick={(e) => { e.stopPropagation(); markAsRead(b.id) }} className="px-2 py-1 rounded bg-neutral-800 border border-neutral-700 text-xs text-neutral-200 hover:bg-neutral-700">Marcar como lido</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="p-2 text-right border-t border-green-800">
              <button onClick={()=>setNotifOpen(false)} className="text-xs px-3 py-1 rounded bg-neutral-800 border border-neutral-700">Fechar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

async function generatePdfForBooking(b: Booking) {
  try {
    const { default: jsPDF } = await import('jspdf')
    // Carrega catálogo de serviços (com cache estático por módulo)
    interface ServiceMeta { id: string; title: string; minutes: number; price: number }
    const g: any = globalThis as any
    if (!g.__svcMetaCache) g.__svcMetaCache = { loaded: false, list: [] as ServiceMeta[] }
    if (!g.__svcMetaCache.loaded) {
      try {
        const supa = getSupabase()
        const { data, error } = await supa.from('services_catalog').select('id,title,minutes,price')
        if (!error && Array.isArray(data)) {
          g.__svcMetaCache.list = (data as any[]).map(r => ({ id: String(r.id), title: String(r.title||'').trim(), minutes: Number(r.minutes||0), price: Number(r.price||0) }))
          g.__svcMetaCache.loaded = true
        }
      } catch {}
    }
    const catalog: ServiceMeta[] = g.__svcMetaCache.list
    const doc = new jsPDF({ unit: 'pt', format: 'A4' })
    const marginX = 56
    let cursorY = 72
    // Header
    doc.setFillColor(22,30,25)
    doc.roundedRect(marginX - 16, cursorY - 52, 500, 90, 12, 12, 'F')
    doc.setFont('helvetica','bold'); doc.setFontSize(20); doc.setTextColor(255,255,255)
    doc.text('Dantas Barber Shop', marginX, cursorY)
    doc.setFontSize(10); doc.setFont('helvetica','normal'); doc.setTextColor(200,230,215)
    doc.text('Comprovante de Agendamento', marginX, cursorY + 16)
    cursorY += 70
    // Resumo
    doc.setFont('helvetica','bold'); doc.setFontSize(12); doc.setTextColor(34,34,34)
    doc.text('Resumo', marginX, cursorY); cursorY += 14
    doc.setDrawColor(30,150,110); doc.setLineWidth(1); doc.line(marginX, cursorY, marginX + 80, cursorY); cursorY += 20
    doc.setFont('helvetica','normal'); doc.setTextColor(40,40,40)
  const formattedDate = (()=>{ const dStr = b.date||''; const m = /^\d{4}-\d{2}-\d{2}$/.test(dStr)? dStr.split('-'): null; if(m) return `${m[2]}-${m[1]}-${m[0]}`; return b.date||'-' })()
  doc.text(`Data: ${formattedDate}`, marginX, cursorY)
    doc.text(`Horário: ${b.time || '-'}`, marginX + 220, cursorY)
    cursorY += 28
    // --- Serviços ---
    const raw = (b as any)._raw || {}
    interface Svc { title: string; minutes: number; price: number }
    let services: Svc[] = []
    // 1. Estruturado
    if (Array.isArray(raw.services_json)) {
      services = raw.services_json.map((s:any)=>({
        title: String(s?.title || s?.name || 'Serviço').replace(/^\s*(AGENDAR|AVULSO)\s*:\s*/i,'').trim() || 'Serviço',
        minutes: Number(s?.minutes || s?.duration || s?.duracao || 0),
        price: Number(s?.price || s?.valor || 0)
      }))
    }
    // 2. Demais chaves
    if (services.length === 0) {
      const candidate = raw.services || raw.servicos || raw.services_list || raw.items || raw.itens
      let arr: any = candidate
      if (typeof arr === 'string') {
        const t = arr.trim()
        if (t.startsWith('[')) { try { arr = JSON.parse(t) } catch {} }
        else if (t.includes(',')) { arr = t.split(',').map((s:string)=>s.trim()) }
      }
      if (Array.isArray(arr)) {
        services = arr.map((it:any)=>{
          if (typeof it === 'string') return { title: it.replace(/^\s*AGENDAR\s*:\s*/i,'').trim(), minutes: 0, price: 0 }
          return {
            title: String(it?.title || it?.name || it?.label || '').replace(/^\s*(AGENDAR|AVULSO)\s*:\s*/i,'').trim() || 'Serviço',
            minutes: Number(it?.minutes || it?.duration || it?.duracao || 0),
            price: Number(it?.price || it?.valor || 0)
          }
        }).filter(s=>s.title)
      }
    }
    // 3. Fallback campo service (pode listar vários separados por vírgula)
    if (services.length === 0) {
  const base = b.service ? b.service.replace(/^\s*(AGENDAR|AVULSO)\s*:\s*/i,'').trim() : ''
      if (base) {
        const parts = base.includes(',') ? base.split(',').map(p=>p.trim()).filter(Boolean) : [base]
        services = parts.map(p=>({ title: p, minutes: 0, price: 0 }))
      }
    }
    // 4. Resolver minutos/preço reais a partir do catálogo quando títulos batem
    const norm = (t:string) => t.toLowerCase()
    services = services.map(s => {
      const titleNorm = norm(s.title)
      // Match por título
      const byTitle = catalog.find(c => norm(c.title) === titleNorm)
      if (byTitle) return { ...s, minutes: byTitle.minutes || s.minutes, price: byTitle.price || s.price }
      // Match por id numérico contido no título (caso título seja id puro)
      const maybeId = s.title && /^\d+$/.test(s.title.trim()) ? s.title.trim() : null
      if (maybeId) {
        const byId = catalog.find(c => c.id === maybeId)
        if (byId) return { ...s, minutes: byId.minutes || s.minutes, price: byId.price || s.price, title: byId.title || s.title }
      }
      return s
    })
    // 5. Se ainda todos minutos =0 mas booking tem duração total, distribuir (fallback apenas)
    if (services.length>0 && services.every(s=>!s.minutes) && (b.durationMinutes||0) > 0) {
      const totalDur = b.durationMinutes || 0
      const base = Math.floor(totalDur / services.length)
      let rem = totalDur - base*services.length
      services = services.map(s=> ({ ...s, minutes: base + (rem>0 ? (rem--,1):0) }))
    }
    // 6. Se todos preços =0 mas booking tem preço total, distribuir (fallback)
    const sumServicePrices = services.reduce((a,s)=>a + (s.price||0),0)
    if (services.length>0 && sumServicePrices === 0 && typeof b.price==='number' && b.price > 0) {
      const per = b.price / services.length
      services = services.map(s=> ({ ...s, price: per }))
    }
    // 7. Linha única se vazio
    if (services.length === 0) {
      services = [{ title: 'Serviço', minutes: b.durationMinutes || 0, price: typeof b.price==='number'? b.price:0 }]
    }
    const totalMinutes = services.reduce((a,s)=>a + (s.minutes||0), 0) || (b.durationMinutes || 0)
    const explicitTotalPrice = typeof b.price==='number' && b.price>0 ? b.price : undefined
    const derivedTotal = services.reduce((a,s)=>a + (s.price||0),0)
    const totalPrice = explicitTotalPrice ?? derivedTotal
    // Tabela
    if (services.length > 0) {
      const tableWidth = 470
      const colService = 270
      const colMinutes = 70
      const colPrice = tableWidth - colService - colMinutes
      doc.setFillColor(236,240,238); doc.setDrawColor(210,220,215); doc.setLineWidth(0.6)
      doc.roundedRect(marginX - 6, cursorY - 14, tableWidth, 26, 4,4,'F')
      doc.setFontSize(10.5); doc.setFont('helvetica','bold'); doc.setTextColor(30,30,30)
      const headY = cursorY + 2
      doc.text('Serviço', marginX, headY)
      doc.text('Min', marginX + colService, headY, { align: 'right' })
      doc.text('Preço (R$)', marginX + colService + colMinutes + colPrice, headY, { align: 'right' })
      cursorY += 16
      doc.setFont('helvetica','normal'); doc.setFontSize(10)
      const rowHeight = 18
      services.forEach((s,idx)=>{
        if (cursorY > 740) { doc.addPage(); cursorY = 72 }
        if (idx % 2 === 0) { doc.setFillColor(249,251,250); doc.rect(marginX - 6, cursorY - 4, tableWidth, rowHeight, 'F') }
        const yMid = cursorY + 12
        let serviceName = s.title || 'Serviço'
        if (serviceName.length > 46) serviceName = serviceName.slice(0,45) + '…'
        doc.setTextColor(45,55,52)
        doc.text(serviceName, marginX, yMid)
        doc.text(String(s.minutes || 0), marginX + colService, yMid, { align: 'right' })
        doc.text((s.price||0).toFixed(2), marginX + colService + colMinutes + colPrice, yMid, { align: 'right' })
        cursorY += rowHeight - 2
      })
      doc.setDrawColor(225,230,228); doc.setLineWidth(0.5); doc.line(marginX - 6, cursorY - 2, marginX - 6 + tableWidth, cursorY - 2)
      cursorY += 16
    }
    // Total
    const totalTop = cursorY
    doc.setFont('helvetica','bold'); doc.setFontSize(12); doc.setFillColor(230,250,243)
    doc.roundedRect(marginX - 10, totalTop, 280, 40, 8,8,'F')
    doc.setTextColor(20,90,70)
    doc.text(`Total: ${totalMinutes} min • R$ ${totalPrice.toFixed(2)}`, marginX, totalTop + 24)
    cursorY = totalTop + 60
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(120,120,120)
    doc.text('Gerado pelo painel do barbeiro. Obrigado!', marginX, cursorY)
    const fileName = `comprovante_${b.date}_${b.time}.pdf`
    doc.save(fileName)
  } catch (e) {
    alert('Falha ao gerar PDF')
  }
}
