<p align="center">
  <img src="https://img.shields.io/badge/OpsBigBro-v0.1.0-22c55e?style=for-the-badge&labelColor=0a0a0a" />
  <img src="https://img.shields.io/badge/Node.js-TypeScript-3178c6?style=for-the-badge&labelColor=0a0a0a&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Next.js-React-000?style=for-the-badge&labelColor=0a0a0a&logo=nextdotjs&logoColor=white" />
  <img src="https://img.shields.io/badge/PostgreSQL-TimescaleDB-336791?style=for-the-badge&labelColor=0a0a0a&logo=postgresql&logoColor=white" />
  <img src="https://img.shields.io/badge/Go-Agent-00ADD8?style=for-the-badge&labelColor=0a0a0a&logo=go&logoColor=white" />
</p>

<h1 align="center">OpsBigBro</h1>
<p align="center"><strong>Unified Infrastructure Command Center</strong></p>
<p align="center">
  Server management, credential vault, uptime monitoring, Docker manager,<br>
  telemetry dashboards & Cloud IDE — all in one platform.
</p>

---

## Overview

OpsBigBro (OBB) is a self-hosted platform for managing servers, credentials, containers and infrastructure monitoring. Built for teams and solo developers who want full control over their infrastructure without vendor lock-in.

### Modules

| Module | Description |
|--------|-------------|
| **Server Vault** | SSH connection manager with Web Terminal (xterm.js), test connection, agent token generation |
| **Access Hub** | Credential vault with groups/folders, password storage, and real-time TOTP/OTP with animated countdown ring |
| **WebHealth & SSL** | URL uptime monitoring with configurable intervals (1m/5m/15m), response time charts, SSL certificate expiry alerts |
| **Telemetry** | Server metrics dashboards (CPU, RAM, Disk, Network) with time-series charts via agent data ingestion |
| **Docker Manager** | Full container lifecycle — deploy from Docker Hub/GHCR registry, start/stop/pause/restart/remove, logs, redeploy, auto-detect image ports/env/volumes |
| **Cloud IDE** | Remote VS Code (code-server) via SSH tunnel — launches, installs and proxies automatically |
| **Webhooks** | Alert dispatcher for Slack/Discord/any URL — health.down, health.up, ssl.expiring, container.exited, metric.alert |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | Node.js (TypeScript), Express, WebSocket (ws), ssh2 |
| **Frontend** | Next.js 15 (React 19), Tailwind CSS, Shadcn UI, Zustand, Recharts |
| **Database** | PostgreSQL 16 (TimescaleDB) via Prisma ORM |
| **Queue** | Redis 7 + BullMQ (health check scheduling) |
| **Agent** | Go / Shell script (lightweight metrics collector) |
| **Proxy** | Nginx (production), Next.js rewrites (dev) |

---

## Architecture

```
Browser (localhost:3000)
  |
  ├── Next.js Frontend (React)
  |     ├── /dashboard        → Overview cards
  |     ├── /servers          → SSH CRUD + Web Terminal
  |     ├── /vault            → Credentials + OTP
  |     ├── /health           → Uptime monitors + charts
  |     ├── /telemetry        → Metrics dashboards
  |     ├── /docker           → Container manager + Registry
  |     ├── /ide              → Cloud IDE launcher
  |     └── /webhooks         → Alert configuration
  |
  ├── Backend API (localhost:3001)
  |     ├── REST API (Express)
  |     ├── WebSocket /ws/terminal (ssh2 bridge)
  |     ├── BullMQ workers (health checks)
  |     └── SSH tunnels (code-server proxy)
  |
  ├── PostgreSQL + TimescaleDB (localhost:5432)
  ├── Redis (localhost:6379)
  |
  └── Remote Servers
        ├── SSH connections (terminal, IDE, Docker)
        └── OBB Agent → POST /api/telemetry/ingest
```

---

## Data Model

```
User ←→ WorkspaceMember ←→ Workspace
                              |
            ┌─────────────────┼─────────────────┐
            |                 |                  |
         Server          VaultGroup         HealthCheck
            |                 |                  |
     ┌──────┼──────┐    Credential            Ping
     |      |      |
  AgentToken Metric Container              Webhook
```

**10 models**: User, Workspace, WorkspaceMember, Server, VaultGroup, Credential, HealthCheck, Ping, AgentToken, Metric, Container, Webhook

---

## Development Setup

### Prerequisites

- **Node.js** 20+ (recommended: 22)
- **Docker** & Docker Compose
- **Git**

### 1. Clone

```bash
git clone https://github.com/joaoventuri/OPSBIGBRO.git
cd OPSBIGBRO
```

### 2. Start databases

```bash
docker compose up -d
```

This starts:
- **PostgreSQL** (TimescaleDB) on port `5432` — user: `opsbigbro`, pass: `opsbigbro`
- **Redis** on port `6379`

### 3. Backend

```bash
cd backend
cp .env.example .env   # or create manually (see below)
npm install
npx prisma generate
npx prisma db push
npx tsx prisma/seed.ts  # creates admin user
npm run dev
```

Backend runs on **http://localhost:3001**

#### Backend `.env`

```env
DATABASE_URL="postgresql://opsbigbro:opsbigbro@localhost:5432/opsbigbro?schema=public"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="any-secret-string-for-dev"
PORT=3001
FRONTEND_URL="http://localhost:3002"
```

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on **http://localhost:3002**

### 5. Login

Open **http://localhost:3002** in your browser.

| Field | Value |
|-------|-------|
| Email | `admin@opsbigbro.local` |
| Password | `admin123` |

---

## Production Installation

### One-liner install (Ubuntu/Debian)

```bash
curl -fsSL https://raw.githubusercontent.com/joaoventuri/OPSBIGBRO/master/install.sh | sudo bash
```

### With options

```bash
# With custom domain + SSL (Let's Encrypt)
sudo bash install.sh --domain=ops.yourdomain.com --admin-email=you@email.com

# Custom admin password
sudo bash install.sh --domain=ops.yourdomain.com --admin-pass=YourSecurePassword

# Custom port, no SSL
sudo bash install.sh --port=8080 --no-ssl
```

### What the installer does

1. Detects OS (Ubuntu 20.04+, Debian 11+)
2. Installs system packages (curl, git, build-essential, nginx, certbot)
3. Installs Docker & Docker Compose
4. Installs Node.js 22
5. Creates `opsbigbro` system user and `/opt/opsbigbro` directory
6. Starts PostgreSQL (TimescaleDB) + Redis via Docker Compose with random passwords
7. Installs backend & frontend dependencies
8. Runs Prisma migrations and seeds admin account
9. Builds Next.js for production
10. Creates systemd services (`opsbigbro-backend`, `opsbigbro-frontend`)
11. Configures Nginx reverse proxy (HTTP, WebSocket, API)
12. Sets up SSL via Let's Encrypt (if `--domain` provided)
13. Configures UFW firewall rules
14. Runs health checks and prints access credentials

### Post-install

After installation, the script prints:

```
╔══════════════════════════════════════════╗
║   OpsBigBro installed successfully!      ║
╚══════════════════════════════════════════╝

  Status:
    Backend API  ● Running
    Frontend     ● Running
    PostgreSQL   ● Running
    Redis        ● Running

  Access:
    URL:       https://ops.yourdomain.com
    Email:     admin@opsbigbro.local
    Password:  (auto-generated)
```

### Managing services

```bash
# Status
systemctl status opsbigbro-backend
systemctl status opsbigbro-frontend

# Restart
sudo systemctl restart opsbigbro-backend
sudo systemctl restart opsbigbro-frontend

# Logs
journalctl -u opsbigbro-backend -f
journalctl -u opsbigbro-frontend -f
```

### Update

```bash
sudo bash /opt/opsbigbro/update.sh
```

### Uninstall

```bash
sudo bash /opt/opsbigbro/install.sh --uninstall
```

---

## Agent Installation

The monitoring agent collects server metrics (CPU, RAM, Disk, Network) and Docker container stats. It runs as a systemd service and sends data every 60 seconds.

### From the UI

1. Go to **Server Vault**
2. Click **Agent** on any server
3. Copy the install command
4. Run it on the target server

### Manual

```bash
curl -fsSL https://your-obb-server/agent/install.sh | bash -s -- \
  --token=YOUR_AGENT_TOKEN \
  --api=https://your-obb-server
```

### Agent management

```bash
systemctl status opsbigbro-agent
systemctl restart opsbigbro-agent
journalctl -u opsbigbro-agent -f
```

---

## Module Details

### Server Vault

- CRUD SSH connections (name, host, port, username, password or private key)
- **Test Connection** — validates SSH before use, shows latency
- **Web Terminal** — full terminal in the browser via xterm.js + ssh2 WebSocket bridge
- **Docker flag** — marks servers for Docker scanning
- **Agent token** — generates one-liner install scripts for the monitoring agent
- **Edit** — modify any field (host, port, credentials) after creation

### Access Hub

- Organize credentials in **groups/folders**
- Store login, password, URL, notes
- **OTP mode** — store TOTP seed, see real-time 6-digit code with animated 30-second countdown ring
- Copy password/OTP to clipboard with one click
- Show/hide password toggle

### WebHealth & SSL

- Monitor any URL with configurable check intervals (1m, 5m, 15m)
- Response time history chart (Recharts)
- **SSL certificate monitoring** — automatic expiry detection, warns via webhook when < 15 days
- Status change webhooks (UP/DOWN transitions)
- BullMQ-powered job scheduling via Redis

### Telemetry

- Real-time server metrics from agent data
- Time-series charts: CPU, RAM, Disk, Network (RX/TX)
- Selectable time ranges (1h, 6h, 24h, 72h)
- Current stats cards with live values
- RAM > 90% alert via webhook

### Docker Manager

#### Containers tab
- List all containers across Docker-enabled servers
- **Scan Servers** — discovers containers via SSH (`docker ps` + `docker stats`)
- Actions per container: Start, Stop, Pause, Unpause, Restart, Remove
- **Redeploy** — pull latest image + recreate container
- **View Logs** — last 200 lines in a dialog
- CPU/RAM stats per container
- Auto-refresh every 10 seconds

#### Deploy tab
- Select target server
- Image name (any registry: Docker Hub, GHCR, private)
- **Auto-detect** — fetches image metadata (exposed ports, env vars, volumes) from Docker Hub Registry API and pre-fills the form
- Dynamic port mapping rows
- Dynamic environment variable rows
- Dynamic volume mount rows
- Container name, restart policy, command override
- Private registry authentication (expandable)
- Falls back to `-P` (publish all exposed ports) when no ports specified

#### Registry tab
- Browse **Docker Hub official images** sorted by popularity
- Category filters: Popular, Databases, Web Servers, Monitoring, Messaging, Dev Tools
- Search Docker Hub and GHCR
- View available **tags** per image
- One-click **Deploy** — goes to Deploy tab with image pre-filled + auto-detected config
- Grid layout with stars, pull counts, official badges

### Cloud IDE

- Launches **code-server** (VS Code Open Source) on remote servers via SSH
- Auto-installs code-server if not present
- Creates SSH tunnel (local TCP forwarding)
- Opens in iframe or new tab
- Full VS Code experience with terminal, extensions, linting

### Webhooks

- Configure endpoints for Slack, Discord, or any URL
- Select events: `health.down`, `health.up`, `ssl.expiring`, `container.exited`, `metric.alert`
- JSON payload with event type, timestamp, and data
- Enable/disable per webhook

---

## API Reference

All protected routes require `Authorization: Bearer <token>` header.

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create account + workspace |
| POST | `/api/auth/login` | Login, returns JWT |
| GET | `/api/auth/me` | Current user + workspaces |

### Servers
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/servers` | List servers |
| GET | `/api/servers/:id` | Get server details |
| POST | `/api/servers` | Create server |
| PUT | `/api/servers/:id` | Update server |
| DELETE | `/api/servers/:id` | Delete server |
| POST | `/api/servers/:id/test` | Test SSH connection |
| POST | `/api/servers/:id/agent-token` | Generate agent token |

### Vault
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/vault/groups` | List groups |
| POST | `/api/vault/groups` | Create group |
| DELETE | `/api/vault/groups/:id` | Delete group |
| GET | `/api/vault/credentials` | List credentials |
| POST | `/api/vault/credentials` | Create credential |
| PUT | `/api/vault/credentials/:id` | Update credential |
| DELETE | `/api/vault/credentials/:id` | Delete credential |

### Health Checks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health-checks` | List monitors |
| POST | `/api/health-checks` | Create monitor |
| GET | `/api/health-checks/:id/pings` | Get ping history |
| DELETE | `/api/health-checks/:id` | Delete monitor |

### Telemetry
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/telemetry/ingest` | Agent data ingestion (token auth) |
| GET | `/api/telemetry/servers/:id/metrics` | Get metrics |
| GET | `/api/telemetry/servers/:id/containers` | Get containers |

### Docker / Containers
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/containers` | List containers |
| POST | `/api/containers/scan` | Scan servers via SSH |
| POST | `/api/containers/action` | Start/stop/pause/restart/remove |
| POST | `/api/containers/deploy` | Deploy new container |
| POST | `/api/containers/redeploy` | Pull latest + recreate |
| GET | `/api/containers/logs/:serverId/:containerId` | View logs |
| GET | `/api/containers/registry/search` | Search Docker Hub/GHCR |
| GET | `/api/containers/registry/browse` | Browse popular images |
| GET | `/api/containers/registry/tags` | Get image tags |
| GET | `/api/containers/registry/inspect` | Get image config (ports/env/volumes) |

### IDE
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ide/start/:serverId` | Start code-server session |
| POST | `/api/ide/stop/:serverId` | Stop session |

### Webhooks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/webhooks` | List webhooks |
| POST | `/api/webhooks` | Create webhook |
| PUT | `/api/webhooks/:id` | Update webhook |
| DELETE | `/api/webhooks/:id` | Delete webhook |

### WebSocket
| Endpoint | Description |
|----------|-------------|
| `ws://host:3001/ws/terminal?token=JWT&serverId=ID` | SSH terminal |

---

## Project Structure

```
OPSBIGBRO/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          # Data model (10 entities)
│   │   └── seed.ts                # Admin user seeder
│   ├── src/
│   │   ├── config/                # env, db, redis
│   │   ├── middleware/            # JWT auth
│   │   ├── modules/
│   │   │   ├── access-hub/        # Credential vault API
│   │   │   ├── cloud-ide/         # Code-server SSH tunnel
│   │   │   ├── docker-watcher/    # Container management + registry
│   │   │   ├── server-vault/      # SSH CRUD + test connection
│   │   │   ├── telemetry/         # Agent ingestion + metrics
│   │   │   ├── web-terminal/      # WebSocket SSH bridge
│   │   │   └── webhealth/         # Uptime monitoring + BullMQ
│   │   ├── routes/                # Auth, webhooks
│   │   ├── services/              # Webhook dispatcher
│   │   └── index.ts               # Express app entry
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── (app)/             # Authenticated layout
│   │   │   │   ├── dashboard/     # Overview
│   │   │   │   ├── servers/       # Server Vault + Terminal
│   │   │   │   ├── vault/         # Access Hub + OTP
│   │   │   │   ├── health/        # WebHealth + Charts
│   │   │   │   ├── telemetry/     # Metrics dashboards
│   │   │   │   ├── docker/        # Docker Manager
│   │   │   │   ├── ide/           # Cloud IDE
│   │   │   │   └── webhooks/      # Webhook config
│   │   │   ├── login/             # Auth page
│   │   │   └── layout.tsx         # Root layout
│   │   ├── components/
│   │   │   ├── ui/                # Shadcn components
│   │   │   └── sidebar.tsx        # Navigation
│   │   ├── lib/                   # API client, utils
│   │   └── stores/                # Zustand auth store
│   └── package.json
├── agent/
│   ├── main.go                    # Go agent (compiled)
│   └── go.mod
├── install.sh                     # Production installer
├── update.sh                      # Updater
├── agent-install.sh               # Agent installer
├── docker-compose.yml             # Dev databases
└── README.md
```

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | required |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `JWT_SECRET` | JWT signing secret | required |
| `PORT` | Backend HTTP port | `3001` |
| `FRONTEND_URL` | Frontend URL (for CORS) | `http://localhost:3000` |

---

## Troubleshooting

### Backend won't start
```bash
# Check if ports are in use
netstat -tlnp | grep -E "3001|5432|6379"

# Check Docker containers
docker compose ps

# Check logs
journalctl -u opsbigbro-backend -f  # production
npm run dev                           # development
```

### Database connection failed
```bash
# Verify PostgreSQL is running
docker compose exec postgres pg_isready -U opsbigbro

# Reset database
npx prisma db push --force-reset
npx tsx prisma/seed.ts
```

### Terminal not connecting
- Terminal connects directly to backend WebSocket on port `3001`
- Verify backend is running and accessible
- Check browser console for WebSocket errors
- Ensure SSH credentials are correct (use **Test Connection** button first)

### Docker scan shows "Docker is not installed"
- The server has `hasDocker` enabled but Docker CLI is not available via SSH
- The flag is automatically disabled after detection
- Install Docker on the server and re-enable the flag

### Cloud IDE not loading
- code-server uses port `18080` on the remote server (must be free)
- Requires `curl` on the remote server for auto-installation
- Check remote logs: `cat /tmp/code-server.log` via SSH

---

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit changes (`git commit -m 'Add my feature'`)
4. Push to branch (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## License

MIT

---

<p align="center">
  <sub>Built with Node.js, Next.js, PostgreSQL, Redis, Go, and a lot of SSH tunnels.</sub>
</p>
