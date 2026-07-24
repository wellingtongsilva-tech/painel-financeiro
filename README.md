# Meu Painel — autocuidado, responsabilidades e finanças

PWA pessoal (instalável, funciona offline) para organizar a rotina diária:

- **Hoje** — visão do dia: resumo financeiro do mês, hábitos, tarefas e contas a pagar.
- **Autocuidado** — hábitos diários (água, remédio, exercício…) com meta por dia e progresso.
- **Tarefas** — responsabilidades com prazo e prioridade (abertas / hoje / todas).
- **Finanças** — entradas e saídas, saldo, gastos por categoria e contas a pagar, por mês.

**Stack:** Node 24 + Express, SQLite nativo (`node:sqlite`, sem módulo nativo), JWT em cookie httpOnly. Frontend em HTML/CSS/JS puro. Login por **senha/token** (uso pessoal, um único usuário — igual ao cockpit). A senha e o **tema** (Sistema/Claro/Escuro) ficam no banco e são alterados dentro do app, em **⚙︎ Configurações**. O `.env` só define a senha **inicial** (primeiro boot).

Servido em produção sob **`iaiabrasil.com/pfin`** (caminhos relativos, funciona em subpath).

### Notificações push (lembretes)

O servidor dispara lembretes via **Web Push (VAPID)** — chegam mesmo com o celular fechado. Em **⚙︎ Configurações** você **ativa as notificações no aparelho** e define os horários de: resumo da manhã, tarefas do dia, contas a pagar (X dias antes) e, por hábito, os horários de lembrete. As chaves VAPID são geradas sozinhas no 1º boot e guardadas no banco; o agendador roda no fuso `America/Sao_Paulo`.

> **iPhone:** o push só funciona depois de **instalar o app na Tela de Início** (Safari → Compartilhar → "Adicionar à Tela de Início"), iOS 16.4+. No Android/Chrome funciona no navegador e instalado.

---

## Rodar local

```bash
cp .env.example .env      # defina ACCESS_TOKEN e JWT_SECRET
npm install
npm start                 # http://localhost:3000
```

Abra `http://localhost:3000`, informe o token do `.env` e pronto.

---

## Deploy no VPS (iaiabrasil.com/pfin)

Segue o **padrão-da-casa do cockpit**: GitHub Actions (`workflow_dispatch`) faz `rsync` do código para `/opt/pfin` e sobe via `docker compose up -d --build`, atrás do nginx.

### 1. Secrets do repositório (Environment `production`)

Em **Settings → Environments → production**, adicione (os mesmos valores usados no cockpit):

| Secret | Descrição |
|--------|-----------|
| `SSH_KEY`  | Chave SSH privada de deploy |
| `SSH_HOST` | Host/IP do VPS |
| `SSH_USER` | Usuário SSH (ex.: `root`) |

> Valores de secret não podem ser copiados entre repositórios via API — precisam ser colados manualmente aqui.

### 2. No VPS (uma vez)

```bash
sudo mkdir -p /opt/pfin/data
sudo tee /opt/pfin/.env >/dev/null <<'EOF'
ACCESS_TOKEN=<senha-inicial-forte>
JWT_SECRET=<segredo-forte>
NODE_ENV=production
PORT=3000
DB_PATH=data/painel.sqlite
EOF
```

> `ACCESS_TOKEN` é só a senha **inicial** (semeada no 1º boot). Depois, troque a senha em **⚙︎ Configurações** dentro do app.

Gerar valores fortes:
```bash
node -e "console.log('ACCESS_TOKEN='+require('crypto').randomBytes(24).toString('base64url'))"
node -e "console.log('JWT_SECRET='+require('crypto').randomBytes(48).toString('hex'))"
```

> O `.env` **não** é versionado nem sincronizado pelo deploy — ele vive só no VPS.

### 3. nginx

Publique o `/pfin` adicionando o bloco de [`deploy/nginx-pfin.conf`](deploy/nginx-pfin.conf) ao vhost de `iaiabrasil.com`, depois:

```bash
nginx -t && systemctl reload nginx
```

O container escuta em `127.0.0.1:8090` (host) → `3000` (container). O nginx faz proxy de `/pfin/` para essa porta removendo o prefixo.

### 4. Deploy

**Actions → Deploy (produção) → Run workflow.** O job: rsync → `docker compose up -d --build` → healthcheck em `/api/health`.

---

## API (resumo)

Todas sob `/api`, exigem cookie de sessão (exceto `POST /api/auth/login`).

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/auth/login` | Login por token → cookie de sessão |
| POST | `/api/auth/logout` | Encerra a sessão |
| GET  | `/api/dashboard` | Visão do dia (hábitos + tarefas + finanças) |
| GET/POST/PATCH/DELETE | `/api/habits` | Hábitos; `POST /:id/toggle` marca o dia |
| GET/POST/PATCH/DELETE | `/api/tasks` | Tarefas; `POST /:id/toggle` conclui |
| GET/POST/PATCH/DELETE | `/api/finance` | Lançamentos; `POST /:id/pay` quita conta; `GET /pending` |

---

## Dados

SQLite em `data/painel.sqlite` (volume `/opt/pfin/data` no VPS). Faça backup desse arquivo para preservar o histórico.
