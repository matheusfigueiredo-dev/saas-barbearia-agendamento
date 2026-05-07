export default function Home() {
  return (
    <div style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#0a0a0a',color:'#fff',padding:'24px'}}>
      <div style={{textAlign:'center',maxWidth:600}}>
        <h1 style={{fontSize:24,fontWeight:600}}>Página movida</h1>
        <p style={{color:'#9ca3af',marginTop:8}}>A versão atual do site roda em Vite (pasta src/) com Supabase. Esta rota Next.js é apenas um placeholder.</p>
        <a href="/" style={{display:'inline-block',marginTop:16,padding:'8px 16px',borderRadius:8,background:'#10b981',color:'#000',fontWeight:600}}>Abrir página inicial</a>
      </div>
    </div>
  )
}
