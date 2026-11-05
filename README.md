# 🌿 Diário de Vida

Uma Progressive Web App (PWA) moderna, pessoal e privada para acompanhamento holístico da rotina diária: sono, nutrição, hidratação, desporto, horas de trabalho (banco de horas) e bem-estar.

---

## ✨ Funcionalidades Principais

- 🌿 **Resumo Diário & Daily Flow:** Visão geral rápida do dia e progresso de preenchimento.
- 🌙 **Registo de Sono:** Horários, qualidade do sono, sonhos e integração com dados Mi Fitness.
- ⚖️ **Peso & Balanço Calórico:** Cálculo de TMB/BMR, calorias consumidas vs. gastas e conselheiro nutricional.
- 🍽️ **Refeições Inteligentes:** Cálculo automático de calorias e macronutrientes com Inteligência Artificial e cache local ultrarrápida.
- 💧 **Hidratação:** Contador de copos de água com alertas e lembretes personalizáveis.
- 🏃 **Exercício Físico:** Registo de treinos, exercícios rápidos e queima calórica.
- 💼 **Trabalho & Banco de Horas:** Registo de entrada, saída, almoço real e cálculo automático de saldo de horas extra.
- 📖 **Diário & Humor:** Notas pessoais, níveis de energia, stress, ansiedade e momentos de gratidão.
- ☁️ **Conta e sincronização com Supabase:** Os registos ficam na tua conta, com cópia no browser para funcionar sem rede. Inclui exportação para Google Sheets.
- 🔒 **Acesso por conta:** Autenticação com Supabase Auth e regras por utilizador na base de dados (RLS).
- 💾 **Backup JSON Completo:** Exportação e importação de dados para nunca perder o histórico.
- 📱 **Progressive Web App (PWA):** Instalação no telemóvel/desktop, suporte offline e notificações.

---

## 🚀 Como Executar Localmente ou Aceder

1. Sirva a pasta com um servidor local (por exemplo `python -m http.server 8765`) e abra `http://localhost:8765`, ou
2. Publique gratuitamente via **GitHub Pages** (Definições do Repositório → Pages → Branch `main` → `/root`).

---

## 🛠️ Tecnologias Utilizadas

- **HTML5 & CSS3:** Design system escuro responsivo (Deep Night, Teal, Sage & Gold).
- **JavaScript (Vanilla / ES6+):** Sem dependências externas pesadas ou frameworks complexos.
- **Service Worker & Web Manifest:** Capacidades offline e instalação PWA.
- **Supabase:** Autenticação, base de dados e Edge Functions (`ai-proxy` e `send-reminders`).
- **APIs de IA:** Gemini, OpenRouter, Groq e Hugging Face, através do `ai-proxy` ou com chaves próprias.