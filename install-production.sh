#!/bin/bash
set -e

# ╔══════════════════════════════════════════════════════════════╗
# ║              ServerLess - Production Installer               ║
# ║          Infrastructure Command Center - v0.1.0              ║
# ╚══════════════════════════════════════════════════════════════╝

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${GREEN}[ServerLess]${NC} $1"; }
warn() { echo -e "${YELLOW}[ServerLess]${NC} $1"; }
err()  { echo -e "${RED}[ServerLess]${NC} $1"; exit 1; }
step() { echo -e "\n${CYAN}${BOLD}━━━ $1 ━━━${NC}\n"; }

# Default values
DOMAIN=""
ADMIN_EMAIL="admin@serverless.local"
ADMIN_PASSWORD=""
INSTALL_DIR="/opt/serverless"
DB_PASSWORD=""
JWT_SECRET=""
UNINSTALL=false

# Parse arguments
for arg in "$@"; do
  case $arg in
    --domain=*)        DOMAIN="${arg#*=}" ;;
    --admin-email=*)   ADMIN_EMAIL="${arg#*=}" ;;
    --admin-password=*) ADMIN_PASSWORD="${arg#*=}" ;;
    --install-dir=*)   INSTALL_DIR="${arg#*=}" ;;
    --uninstall)       UNINSTALL=true ;;
    --help)
      echo "Usage: bash install-production.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --domain=example.com           Domain for ServerLess (required for SSL)"
      echo "  --admin-email=admin@email.com  Admin email (default: admin@serverless.local)"
      echo "  --admin-password=secret        Admin password (auto-generated if empty)"
      echo "  --install-dir=/path            Installation directory (default: /opt/serverless)"
      echo "  --uninstall                    Remove ServerLess completely"
      echo "  --help                         Show this help"
      echo ""
      echo "Example:"
      echo "  bash install-production.sh --domain=serverless.example.com --admin-email=admin@example.com"
      exit 0
      ;;
  esac
done

# ─── Uninstall ───────────────────────────────────────────────
if [ "$UNINSTALL" = true ]; then
  step "Uninstalling ServerLess"
  
  systemctl stop serverless-backend serverless-frontend 2>/dev/null || true
  systemctl disable serverless-backend serverless-frontend 2>/dev/null || true
  rm -f /etc/systemd/system/serverless-*.service
  systemctl daemon-reload
  
  cd "$INSTALL_DIR" 2>/dev/null && docker compose down -v 2>/dev/null || true
  
  rm -rf "$INSTALL_DIR"
  userdel -r serverless 2>/dev/null || true
  
  # Remove Caddy config if exists
  if [ -f /etc/caddy/Caddyfile ]; then
    sed -i "/# ServerLess/,/^}/d" /etc/caddy/Caddyfile
    systemctl reload caddy 2>/dev/null || true
  fi
  
  # Remove cron job
  crontab -l 2>/dev/null | grep -v "serverless" | crontab - || true
  
  log "ServerLess removed successfully."
  exit 0
fi

# ─── Pre-flight checks ───────────────────────────────────────
step "Pre-flight checks"

[ "$(id -u)" -eq 0 ] || err "This script must be run as root (use sudo)"

if [ -z "$DOMAIN" ]; then
  err "Domain is required! Use --domain=your-domain.com"
fi

# Generate secrets if not provided
if [ -z "$ADMIN_PASSWORD" ]; then
  ADMIN_PASSWORD=$(openssl rand -base64 16 | tr -d '/+=')
  warn "Generated admin password: $ADMIN_PASSWORD"
fi

JWT_SECRET=$(openssl rand -hex 32)
DB_PASSWORD=$(openssl rand -hex 16)

log "Domain: $DOMAIN"
log "Admin email: $ADMIN_EMAIL"
log "Install directory: $INSTALL_DIR"

# ─── Install system dependencies ─────────────────────────────
step "Installing system dependencies"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  curl wget git build-essential \
  ca-certificates gnupg lsb-release \
  software-properties-common \
  jq unzip > /dev/null 2>&1

log "System packages installed"

# ─── Install Docker ──────────────────────────────────────────
step "Setting up Docker"

if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh > /dev/null 2>&1
  systemctl enable docker > /dev/null 2>&1
  systemctl start docker
  log "Docker installed"
else
  log "Docker already installed: $(docker --version)"
fi

if ! docker compose version &>/dev/null 2>&1; then
  apt-get install -y -qq docker-compose-plugin > /dev/null 2>&1
fi

log "Docker Compose ready"

# ─── Install Node.js ─────────────────────────────────────────
step "Setting up Node.js"

if ! command -v node &>/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null 2>&1
  log "Node.js installed: $(node -v)"
else
  log "Node.js already installed: $(node -v)"
fi

# ─── Install Caddy ───────────────────────────────────────────
step "Setting up Caddy"

if ! command -v caddy &>/dev/null; then
  apt install -y debian-keyring debian-archive-keyring apt-transport-https curl > /dev/null 2>&1
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
  apt-get update -qq
  apt-get install -y -qq caddy > /dev/null 2>&1
  systemctl enable caddy > /dev/null 2>&1
  log "Caddy installed"
else
  log "Caddy already installed: $(caddy version | head -1)"
fi

# ─── Create serverless user ──────────────────────────────────
step "Creating serverless user"

if ! id serverless &>/dev/null; then
  useradd -r -s /bin/bash -d "$INSTALL_DIR" -m serverless
  log "User 'serverless' created"
else
  log "User 'serverless' already exists"
fi

# ─── Clone repository ────────────────────────────────────────
step "Cloning ServerLess repository"

if [ -d "$INSTALL_DIR/.git" ]; then
  log "Repository already exists, pulling latest..."
  cd "$INSTALL_DIR"
  sudo -u serverless git pull origin main > /dev/null 2>&1 || warn "Git pull failed, continuing..."
else
  log "Cloning repository..."
  git clone https://github.com/joaoventuri/ServerLess.git "$INSTALL_DIR" > /dev/null 2>&1
  chown -R serverless:serverless "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# ─── Start PostgreSQL + Redis ────────────────────────────────
step "Starting database services"

cat > docker-compose.yml << EOF
version: "3.9"

services:
  postgres:
    image: timescale/timescaledb:latest-pg16
    restart: unless-stopped
    environment:
      POSTGRES_USER: serverless
      POSTGRES_PASSWORD: $DB_PASSWORD
      POSTGRES_DB: serverless
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks:
      - serverless

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redisdata:/data
    networks:
      - serverless

volumes:
  pgdata:
  redisdata:

networks:
  serverless:
    driver: bridge
EOF

docker compose up -d > /dev/null 2>&1
sleep 5
log "PostgreSQL and Redis started"

# ─── Configure backend ───────────────────────────────────────
step "Configuring backend"

cat > backend/.env << EOF
DATABASE_URL="postgresql://serverless:$DB_PASSWORD@localhost:5432/serverless"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="$JWT_SECRET"
NODE_ENV="production"
PORT="3001"
FRONTEND_URL="https://$DOMAIN"
EOF

log "Backend .env created"

# Install backend dependencies
cd backend
sudo -u serverless npm install --production > /dev/null 2>&1 || warn "Backend npm install had warnings"

# Run migrations
sudo -u serverless npx prisma migrate deploy > /dev/null 2>&1 || warn "Migrations may have failed"

# Add production script to package.json
sudo -u serverless npx json -I -f package.json -e 'this.scripts.prod="NODE_ENV=production tsx src/index.ts"' || true

log "Backend configured"

# ─── Configure frontend ──────────────────────────────────────
step "Configuring frontend"

cd ../frontend

cat > .env.production << EOF
NODE_ENV=production
NEXT_PUBLIC_API_URL=http://localhost:3001
EOF

log "Frontend .env created"

# Install frontend dependencies and build
sudo -u serverless npm install --production > /dev/null 2>&1 || warn "Frontend npm install had warnings"
sudo -u serverless npm run build > /dev/null 2>&1 || warn "Frontend build had warnings"

log "Frontend built"

# ─── Create admin user ───────────────────────────────────────
step "Creating admin user"

cd "$INSTALL_DIR/backend"

cat > create-admin.ts << EOF
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash("$ADMIN_PASSWORD", 10);
  
  const user = await prisma.user.upsert({
    where: { email: "$ADMIN_EMAIL" },
    update: { password, name: "Admin" },
    create: {
      name: "Admin",
      email: "$ADMIN_EMAIL",
      password,
    },
  });

  const workspace = await prisma.workspace.upsert({
    where: { slug: "default" },
    update: {},
    create: {
      name: "Default Workspace",
      slug: "default",
      members: {
        create: { userId: user.id, role: "owner" },
      },
    },
  });

  console.log("✅ Admin user created");
}

main()
  .catch(console.error)
  .finally(() => prisma.\$disconnect());
EOF

sudo -u serverless npx tsx create-admin.ts > /dev/null 2>&1

log "Admin user created: $ADMIN_EMAIL"

# ─── Create systemd services ─────────────────────────────────
step "Creating systemd services"

cat > /etc/systemd/system/serverless-backend.service << EOF
[Unit]
Description=ServerLess Backend (Production)
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=serverless
WorkingDirectory=$INSTALL_DIR/backend
Environment="NODE_ENV=production"
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
ExecStart=/usr/bin/npm run prod
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/serverless-frontend.service << EOF
[Unit]
Description=ServerLess Frontend (Production)
After=network.target serverless-backend.service

[Service]
Type=simple
User=serverless
WorkingDirectory=$INSTALL_DIR/frontend
Environment="NODE_ENV=production"
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable serverless-backend serverless-frontend > /dev/null 2>&1
systemctl start serverless-backend serverless-frontend

log "Systemd services created and started"

# ─── Configure Caddy ─────────────────────────────────────────
step "Configuring Caddy reverse proxy"

# Backup existing Caddyfile
if [ -f /etc/caddy/Caddyfile ]; then
  cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.backup
fi

# Add ServerLess config if not exists
if ! grep -q "# ServerLess" /etc/caddy/Caddyfile 2>/dev/null; then
  cat >> /etc/caddy/Caddyfile << EOF

# ServerLess
$DOMAIN {
    reverse_proxy localhost:3000
    encode gzip
    
    header {
        X-Content-Type-Options "nosniff"
        X-Frame-Options "SAMEORIGIN"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
    
    log {
        output file /var/log/caddy/serverless.log {
            roll_size 10mb
            roll_keep 5
        }
    }
}
EOF
fi

systemctl reload caddy
log "Caddy configured for $DOMAIN"

# ─── Setup auto-update ───────────────────────────────────────
step "Setting up auto-update"

cat > "$INSTALL_DIR/auto-update.sh" << 'EOF'
#!/bin/bash
set -e

LOG_FILE="/var/log/serverless-update.log"
REPO_DIR="/opt/serverless"

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "🔄 Checking for updates..."

cd "$REPO_DIR"
git fetch origin main > /dev/null 2>&1

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
    log "✅ Already up to date"
    exit 0
fi

log "🆕 New version available, updating..."
git pull origin main > /dev/null 2>&1

log "📦 Installing backend dependencies..."
cd backend && npm install --production > /dev/null 2>&1

log "📦 Installing frontend dependencies..."
cd ../frontend && npm install --production > /dev/null 2>&1

log "🏗️  Building frontend..."
npm run build > /dev/null 2>&1

log "🔄 Restarting services..."
systemctl restart serverless-backend serverless-frontend

log "✅ Update complete!"
EOF

chmod +x "$INSTALL_DIR/auto-update.sh"

# Add cron job if not exists
if ! crontab -l 2>/dev/null | grep -q "serverless/auto-update.sh"; then
  (crontab -l 2>/dev/null || true; echo "*/10 * * * * $INSTALL_DIR/auto-update.sh >> /var/log/serverless-update.log 2>&1") | crontab -
  log "Auto-update cron job created (runs every 10 minutes)"
fi

# ─── Final checks ────────────────────────────────────────────
step "Running final checks"

sleep 5

BACKEND_STATUS=$(systemctl is-active serverless-backend)
FRONTEND_STATUS=$(systemctl is-active serverless-frontend)

if [ "$BACKEND_STATUS" = "active" ] && [ "$FRONTEND_STATUS" = "active" ]; then
  log "✅ Backend: $BACKEND_STATUS"
  log "✅ Frontend: $FRONTEND_STATUS"
else
  warn "⚠️  Backend: $BACKEND_STATUS"
  warn "⚠️  Frontend: $FRONTEND_STATUS"
  warn "Check logs: journalctl -u serverless-backend -u serverless-frontend -f"
fi

# ─── Success message ─────────────────────────────────────────
step "Installation complete!"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              ServerLess Installation Complete!              ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}Access URL:${NC}      https://$DOMAIN"
echo -e "${CYAN}Admin Email:${NC}     $ADMIN_EMAIL"
echo -e "${CYAN}Admin Password:${NC}  $ADMIN_PASSWORD"
echo ""
echo -e "${YELLOW}⚠️  IMPORTANT: Save these credentials in a safe place!${NC}"
echo ""
echo -e "${CYAN}Logs:${NC}"
echo "  Backend:  journalctl -u serverless-backend -f"
echo "  Frontend: journalctl -u serverless-frontend -f"
echo "  Updates:  tail -f /var/log/serverless-update.log"
echo ""
echo -e "${CYAN}Management:${NC}"
echo "  Restart:  systemctl restart serverless-backend serverless-frontend"
echo "  Status:   systemctl status serverless-backend serverless-frontend"
echo "  Update:   $INSTALL_DIR/auto-update.sh"
echo ""
echo -e "${GREEN}✅ ServerLess is running in production mode!${NC}"
echo ""
