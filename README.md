# ✂️ Dantas Barber - SaaS de Agendamento e Gestão

> 🚀 **Status:** Em Produção | Atendendo clientes reais desde Novembro de 2025.

🔗 **Acesse o sistema ao vivo:** [dantasbarber.netlify.app](https://dantasbarber.netlify.app)

---

## 💻 Sobre o Projeto
Plataforma completa (SaaS) desenvolvida para digitalizar e otimizar o fluxo de trabalho de barbearias. O sistema permite que clientes realizem agendamentos de forma autônoma 24/7, enquanto fornece ao barbeiro um painel administrativo para gestão de horários, serviços e faturamento. 

A aplicação foi construída com foco em **Mobile-First** e configurada como **PWA (Progressive Web App)**, oferecendo uma experiência de aplicativo nativo diretamente no navegador do celular do usuário.

## 🛠️ Tecnologias Utilizadas

* **Front-end:** React, TypeScript, Vite
* **Estilização:** Tailwind CSS
* **Back-end & Database:** Supabase (PostgreSQL, Autenticação, RLS)
* **Arquitetura:** PWA (Progressive Web App)
* **Hospedagem:** Netlify

## ✨ Principais Funcionalidades

**Para o Cliente:**
* Interface intuitiva e responsiva (Mobile-First).
* Visualização de horários disponíveis em tempo real.
* Agendamento rápido de serviços (Corte, Barba, etc).
* Instalação do app no celular (via PWA) para acesso rápido.

**Para o Barbeiro (Admin):**
* Autenticação segura via Supabase.
* Dashboard completo de agendamentos do dia/semana.
* Controle de disponibilidade e bloqueio automático de horários conflitantes.
* Gestão de métricas e serviços prestados.

## 🚀 Como executar o projeto localmente

```bash
# Clone o repositório
git clone [https://github.com/matheusfigueiredo-dev/saas-barbearia-agendamento.git](https://github.com/matheusfigueiredo-dev/saas-barbearia-agendamento.git)

# Entre na pasta do projeto
cd web

# Instale as dependências
npm install

# Configure as variáveis de ambiente (.env) com as credenciais do Supabase
# VITE_SUPABASE_URL=sua_url_aqui
# VITE_SUPABASE_ANON_KEY=sua_chave_aqui

# Inicie o servidor de desenvolvimento
npm run dev
