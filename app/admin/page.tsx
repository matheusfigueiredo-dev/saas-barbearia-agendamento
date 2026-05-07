export default function AdminPage() {
  return (
    <div style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#0a0a0a',color:'#fff',padding:'24px'}}>
      <div style={{textAlign:'center',maxWidth:600}}>
        <h1 style={{fontSize:24,fontWeight:600}}>Gestão movida</h1>
        <p style={{color:'#9ca3af',marginTop:8}}>Use o painel em Vite na rota <code>/admin</code> (pasta src/routes/Admin.tsx), já integrado ao Supabase. Esta página Next.js é apenas um placeholder.</p>
        <a href="/admin" style={{display:'inline-block',marginTop:16,padding:'8px 16px',borderRadius:8,background:'#10b981',color:'#000',fontWeight:600}}>Abrir painel</a>
      </div>
    </div>
  )
}
