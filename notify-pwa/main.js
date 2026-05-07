async function getVapidPublicKey() {
  const r = await fetch('/api/push-vapid-public', { method: 'GET' })
  if (!r.ok) throw new Error('Falha ao buscar VAPID public key')
  const j = await r.json()
  return j.key
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) { outputArray[i] = rawData.charCodeAt(i) }
  return outputArray
}

async function register() {
  const statusEl = document.getElementById('status')
  const hint = document.getElementById('hint')
  const btn = document.getElementById('btn-enable')

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    statusEl.textContent = 'Seu navegador não suporta notificações push.'
    return
  }

  const permission = Notification.permission
  if (permission === 'denied') { statusEl.textContent = 'Permissão de notificação bloqueada nas configurações.'; return }

  statusEl.textContent = 'Registrando service worker…'
  const reg = await navigator.serviceWorker.register('./sw.js')

  btn.disabled = false
  statusEl.textContent = 'Pronto para ativar.'
  btn.addEventListener('click', async () => {
    btn.disabled = true
    try {
      if (Notification.permission !== 'granted') {
        const result = await Notification.requestPermission()
        if (result !== 'granted') { statusEl.textContent = 'Permissão negada.'; btn.disabled = false; return }
      }
      statusEl.textContent = 'Gerando inscrição…'
      const vapid = await getVapidPublicKey()
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapid) })
      statusEl.textContent = 'Enviando inscrição…'
      const res = await fetch('/api/push-register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub, label: 'barbeiro' }) })
      if (!res.ok) throw new Error('Falha ao registrar inscrição')
      statusEl.textContent = 'Notificações ativadas!'
      hint.textContent = 'Pode fechar esta página. Você receberá avisos de novos agendamentos.'
    } catch (e) {
      console.error(e)
      statusEl.textContent = 'Erro ao ativar. Veja o console.'
      btn.disabled = false
    }
  })
}

register().catch((e)=>{ console.error(e); document.getElementById('status').textContent = 'Falha ao iniciar.' })
