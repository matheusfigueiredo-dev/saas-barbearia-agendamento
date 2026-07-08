import React, { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'

type ChatRole = 'user' | 'assistant'

type ChatMessage = {
  role: ChatRole
  content: string
}

const SYSTEM_HINT = 'Assistente Dantas Barber'
const FRIENDLY_ERROR_MESSAGE =
  'Nosso assistente esta muito requisitado no momento e tomando um folego! Por favor, aguarde alguns minutos e tente novamente.'

function isServiceErrorReply(reply: string) {
  return (
    reply.includes('GoogleGenerativeAI Error') ||
    reply.includes('Error fetching') ||
    reply.includes('Too Many Requests') ||
    reply.includes('Service Unavailable') ||
    reply.includes('QuotaFailure') ||
    reply.includes('errorType')
  )
}

export default function AIChatModal() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: 'Oi! Sou o assistente da Dantas Barber. Quer ajuda para escolher um servico ou verificar horarios?'
    }
  ])
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const headerSubtitle = useMemo(() => {
    if (loading) return 'Pensando em algo incrivel...'
    return 'Seu assistente premium de agendamentos'
  }, [loading])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!listRef.current) return
    listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, loading])

  async function sendMessage() {
    const trimmed = input.trim()
    if (!trimmed || loading) return

    const userMessage: ChatMessage = { role: 'user', content: trimmed }
    const nextMessages = [...messages, userMessage]

    setMessages(nextMessages)
    setInput('')
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/.netlify/functions/ai-agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages })
      })

      if (!response.ok) {
        throw new Error('assistant_unavailable')
      }

      const data = (await response.json()) as { reply?: string; error?: string }
      if (data.error) throw new Error('assistant_unavailable')

      const reply = (data.reply || 'Nao consegui responder agora.').trim()
      if (isServiceErrorReply(reply)) throw new Error('assistant_unavailable')
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }])
    } catch {
      setError(FRIENDLY_ERROR_MESSAGE)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: FRIENDLY_ERROR_MESSAGE
        }
      ])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendMessage()
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 rounded-full bg-gradient-to-br from-emerald-400 via-cyan-400 to-blue-500 p-[2px] shadow-[0_0_25px_rgba(16,185,129,0.5)] transition hover:scale-[1.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
        aria-label="Abrir chat do assistente"
      >
        <span className="flex items-center gap-2 rounded-full bg-neutral-950 px-4 py-3 text-sm font-semibold text-white tracking-wide">
          <span className="h-2 w-2 rounded-full bg-emerald-300 animate-pulse" aria-hidden="true" />
          Chat
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="relative w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl border border-emerald-400/20 bg-neutral-950/95 shadow-[0_25px_60px_rgba(0,0,0,0.55)] overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.2),_transparent_50%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,_rgba(59,130,246,0.2),_transparent_45%)]" />

            <div className="relative flex items-center justify-between px-6 pt-6 pb-4 border-b border-white/10">
              <div>
                <p className="text-xs uppercase tracking-[0.4em] text-emerald-300/80">{SYSTEM_HINT}</p>
                <h2 className="text-lg font-semibold text-white font-['Space_Grotesk']">Agente de Agendamentos</h2>
                <p className="text-xs text-white/60 mt-1">{headerSubtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80 hover:bg-white/10"
              >
                Fechar
              </button>
            </div>

            <div
              ref={listRef}
              className="relative max-h-[60vh] sm:max-h-[65vh] overflow-y-auto px-6 py-5 space-y-4"
            >
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={clsx('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={clsx(
                      'max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-lg',
                      message.role === 'user'
                        ? 'bg-emerald-400/90 text-neutral-950'
                        : 'bg-white/5 text-white border border-white/10'
                    )}
                  >
                    {message.content}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-white/80">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-300 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="h-2 w-2 rounded-full bg-emerald-300 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="h-2 w-2 rounded-full bg-emerald-300 animate-bounce" style={{ animationDelay: '300ms' }} />
                      <span className="text-xs text-white/60">Digitando...</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="relative border-t border-white/10 px-6 py-4 bg-neutral-950">
              {error && <p className="text-xs text-red-300 mb-2">{error}</p>}
              <div className="flex items-center gap-3">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Escreva sua mensagem..."
                  className="flex-1 rounded-xl border border-white/10 bg-neutral-900 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-400/60 font-['Space_Grotesk']"
                />
                <button
                  type="button"
                  onClick={() => void sendMessage()}
                  disabled={!input.trim() || loading}
                  className="rounded-xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-neutral-950 shadow hover:bg-emerald-300 disabled:opacity-50"
                >
                  Enviar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
