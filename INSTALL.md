# 🚀 ServerLess - Production Installation Guide

## Quick Install (One Command)

```bash
curl -fsSL https://raw.githubusercontent.com/joaoventuri/ServerLess/main/install-production.sh | sudo bash -s -- \
  --domain=your-domain.com \
  --admin-email=admin@your-domain.com
```

The installer will:
- ✅ Install all dependencies (Docker, Node.js, Caddy)
- ✅ Clone and configure ServerLess
- ✅ Setup PostgreSQL + Redis (Docker)
- ✅ Create admin user with auto-generated password
- ✅ Configure Caddy reverse proxy with automatic SSL
- ✅ Setup systemd services for auto-start
- ✅ Configure auto-update via cron (every 10 minutes)

---

## Installation Options

```bash
bash install-production.sh [OPTIONS]

Options:
  --domain=example.com           Domain for ServerLess (required for SSL)
  --admin-email=admin@email.com  Admin email (default: admin@serverless.local)
  --admin-password=secret        Admin password (auto-generated if empty)
  --install-dir=/path            Installation directory (default: /opt/serverless)
  --uninstall                    Remove ServerLess completely
  --help                         Show this help
```

### Example with Custom Password

```bash
curl -fsSL https://raw.githubusercontent.com/joaoventuri/ServerLess/main/install-production.sh | sudo bash -s -- \
  --domain=serverless.example.com \
  --admin-email=admin@example.com \
  --admin-password=MySecurePassword123
```

---

## What Gets Installed

### System Dependencies
- **Docker** - Container runtime
- **Docker Compose** - Multi-container orchestration
- **Node.js 22** - JavaScript runtime
- **Caddy** - Reverse proxy with automatic HTTPS

### ServerLess Components
- **Backend** (Node.js + TypeScript + Express)
- **Frontend** (Next.js 15 + React 19)
- **PostgreSQL 16** (with TimescaleDB)
- **Redis 7** - Cache and queue

### System Services
- `serverless-backend.service` - Backend API
- `serverless-frontend.service` - Frontend web app
- Auto-update cron job (every 10 minutes)

---

## Post-Installation

### Access Your Instance

After installation completes, access:

```
https://your-domain.com
```

Login with the credentials shown at the end of installation.

### Check Status

```bash
# Services status
systemctl status serverless-backend serverless-frontend

# View logs
journalctl -u serverless-backend -f
journalctl -u serverless-frontend -f

# Update logs
tail -f /var/log/serverless-update.log
```

### Manual Operations

```bash
# Restart services
sudo systemctl restart serverless-backend serverless-frontend

# Force update
sudo /opt/serverless/auto-update.sh

# Uninstall
curl -fsSL https://raw.githubusercontent.com/joaoventuri/ServerLess/main/install-production.sh | sudo bash -s -- --uninstall
```

---

## Architecture

```
Internet
  │
  ├─→ Caddy (Port 443 HTTPS)
       │
       └─→ Next.js Frontend (Port 3000)
            │
            └─→ Backend API (Port 3001)
                 │
                 ├─→ PostgreSQL (Port 5432)
                 └─→ Redis (Port 6379)
```

---

## System Requirements

- **OS**: Ubuntu 20.04+ / Debian 11+
- **RAM**: 2GB minimum (4GB recommended)
- **Disk**: 10GB minimum (20GB recommended)
- **Root access** required
- **Domain** with DNS pointing to server

---

## Security Features

- ✅ **Automatic HTTPS** (Let's Encrypt via Caddy)
- ✅ **Bcrypt password hashing**
- ✅ **JWT authentication**
- ✅ **Security headers** (CSP, XSS protection, etc.)
- ✅ **Non-root user** for services
- ✅ **Isolated Docker network**

---

## Auto-Update

ServerLess automatically checks for updates every 10 minutes:

1. Fetches latest from GitHub
2. Installs new dependencies
3. Rebuilds frontend
4. Restarts services

**No downtime** - Systemd handles graceful restarts.

---

## Troubleshooting

### Installation Failed

Check logs:
```bash
journalctl -xe
```

### Service Won't Start

```bash
# Backend logs
journalctl -u serverless-backend -n 50

# Frontend logs
journalctl -u serverless-frontend -n 50

# Check ports
ss -tlnp | grep -E '3000|3001'
```

### Database Connection Error

```bash
# Check PostgreSQL
docker logs serverless-postgres-1

# Check Redis
docker logs serverless-redis-1

# Restart database services
cd /opt/serverless && docker compose restart
```

### SSL Certificate Issues

```bash
# Check Caddy
systemctl status caddy
journalctl -u caddy -n 50

# Test config
sudo caddy validate --config /etc/caddy/Caddyfile

# Reload Caddy
sudo systemctl reload caddy
```

---

## Manual Installation (Advanced)

If you prefer manual installation, see [README.md](./README.md) for detailed steps.

---

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/joaoventuri/ServerLess/main/install-production.sh | sudo bash -s -- --uninstall
```

This will:
- Stop and remove all services
- Delete installation directory
- Remove cron jobs
- Clean up Caddy configuration
- Remove Docker containers and volumes

**⚠️ WARNING: This will delete all data including the database!**

---

## Support

- **Issues**: https://github.com/joaoventuri/ServerLess/issues
- **Discussions**: https://github.com/joaoventuri/ServerLess/discussions
- **Documentation**: https://github.com/joaoventuri/ServerLess

---

## License

MIT - See [LICENSE](./LICENSE) for details.
