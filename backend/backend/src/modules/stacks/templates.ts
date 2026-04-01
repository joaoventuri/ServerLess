// Curated stack templates — marketplace of self-hosted apps
// Each template is a complete docker-compose.yml ready to deploy

export interface StackTemplate {
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  tags: string[];
  website: string;
  compose: string;
}

export const STACK_TEMPLATES: StackTemplate[] = [
  // ─── Productivity ─────────────────────────────────────────
  {
    slug: "n8n",
    name: "n8n",
    description: "Workflow automation tool — connect anything to everything",
    icon: "🔄",
    category: "Automation",
    tags: ["automation", "workflow", "integration", "no-code"],
    website: "https://n8n.io",
    compose: `services:
  n8n:
    image: n8nio/n8n:latest
    container_name: n8n
    restart: unless-stopped
    ports:
      - "5678:5678"
    environment:
      N8N_HOST: \${N8N_HOST:-localhost}
      N8N_PORT: "5678"
      N8N_PROTOCOL: \${N8N_PROTOCOL:-http}
      WEBHOOK_URL: \${WEBHOOK_URL:-http://localhost:5678/}
      GENERIC_TIMEZONE: \${TIMEZONE:-America/Sao_Paulo}
      N8N_ENCRYPTION_KEY: \${N8N_ENCRYPTION_KEY:-change-me-please}
      DB_TYPE: postgresdb
      DB_POSTGRESDB_HOST: n8n-db
      DB_POSTGRESDB_PORT: "5432"
      DB_POSTGRESDB_DATABASE: n8n
      DB_POSTGRESDB_USER: n8n
      DB_POSTGRESDB_PASSWORD: \${DB_PASSWORD:-n8n123}
      EXECUTIONS_MODE: queue
      QUEUE_BULL_REDIS_HOST: n8n-redis
      QUEUE_BULL_REDIS_PORT: "6379"
    volumes:
      - n8n_data:/home/node/.n8n
    depends_on:
      n8n-db:
        condition: service_healthy
      n8n-redis:
        condition: service_healthy

  n8n-db:
    image: postgres:16-alpine
    container_name: n8n-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: n8n
      POSTGRES_PASSWORD: \${DB_PASSWORD:-n8n123}
      POSTGRES_DB: n8n
    volumes:
      - n8n_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U n8n"]
      interval: 5s
      timeout: 5s
      retries: 5

  n8n-redis:
    image: redis:7-alpine
    container_name: n8n-redis
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  n8n_data:
  n8n_pgdata:`,
  },
  {
    slug: "nocodb",
    name: "NocoDB",
    description: "Open source Airtable alternative — turns any database into a spreadsheet",
    icon: "📊",
    category: "Database",
    tags: ["database", "spreadsheet", "airtable", "no-code"],
    website: "https://nocodb.com",
    compose: `services:
  nocodb:
    image: nocodb/nocodb:latest
    container_name: nocodb
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      NC_DB: "pg://nocodb-db:5432?u=nocodb&p=\${DB_PASSWORD:-nocodb123}&d=nocodb"
    volumes:
      - nocodb_data:/usr/app/data
    depends_on:
      nocodb-db:
        condition: service_healthy

  nocodb-db:
    image: postgres:16-alpine
    container_name: nocodb-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: nocodb
      POSTGRES_PASSWORD: \${DB_PASSWORD:-nocodb123}
      POSTGRES_DB: nocodb
    volumes:
      - nocodb_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nocodb"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  nocodb_data:
  nocodb_pgdata:`,
  },
  {
    slug: "baserow",
    name: "Baserow",
    description: "Open source no-code database and Airtable alternative",
    icon: "🗃️",
    category: "Database",
    tags: ["database", "spreadsheet", "airtable", "no-code"],
    website: "https://baserow.io",
    compose: `services:
  baserow:
    image: baserow/baserow:latest
    container_name: baserow
    restart: unless-stopped
    ports:
      - "8080:80"
    environment:
      BASEROW_PUBLIC_URL: \${BASEROW_PUBLIC_URL:-http://localhost:8080}
    volumes:
      - baserow_data:/baserow/data

volumes:
  baserow_data:`,
  },
  {
    slug: "uptime-kuma",
    name: "Uptime Kuma",
    description: "Self-hosted monitoring tool like Uptime Robot",
    icon: "📈",
    category: "Monitoring",
    tags: ["monitoring", "uptime", "status-page"],
    website: "https://github.com/louislam/uptime-kuma",
    compose: `services:
  uptime-kuma:
    image: louislam/uptime-kuma:latest
    container_name: uptime-kuma
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - uptime_kuma_data:/app/data

volumes:
  uptime_kuma_data:`,
  },
  {
    slug: "chatwoot",
    name: "Chatwoot",
    description: "Open source customer engagement platform — live chat, email, social",
    icon: "💬",
    category: "Communication",
    tags: ["chat", "support", "crm", "customer-service"],
    website: "https://chatwoot.com",
    compose: `services:
  chatwoot-app:
    image: chatwoot/chatwoot:latest
    container_name: chatwoot-app
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      RAILS_ENV: production
      SECRET_KEY_BASE: \${SECRET_KEY_BASE:-$(openssl rand -hex 32)}
      FRONTEND_URL: \${FRONTEND_URL:-http://localhost:3000}
      POSTGRES_HOST: chatwoot-db
      POSTGRES_USERNAME: chatwoot
      POSTGRES_PASSWORD: \${DB_PASSWORD:-chatwoot123}
      POSTGRES_DATABASE: chatwoot
      REDIS_URL: redis://chatwoot-redis:6379
      RAILS_LOG_TO_STDOUT: "true"
    entrypoint: docker/entrypoints/rails.sh
    command: ["bundle", "exec", "rails", "s", "-p", "3000", "-b", "0.0.0.0"]
    volumes:
      - chatwoot_storage:/app/storage
    depends_on:
      chatwoot-db:
        condition: service_healthy
      chatwoot-redis:
        condition: service_healthy

  chatwoot-worker:
    image: chatwoot/chatwoot:latest
    container_name: chatwoot-worker
    restart: unless-stopped
    environment:
      RAILS_ENV: production
      SECRET_KEY_BASE: \${SECRET_KEY_BASE:-$(openssl rand -hex 32)}
      POSTGRES_HOST: chatwoot-db
      POSTGRES_USERNAME: chatwoot
      POSTGRES_PASSWORD: \${DB_PASSWORD:-chatwoot123}
      POSTGRES_DATABASE: chatwoot
      REDIS_URL: redis://chatwoot-redis:6379
    entrypoint: docker/entrypoints/rails.sh
    command: ["bundle", "exec", "sidekiq", "-C", "config/sidekiq.yml"]
    volumes:
      - chatwoot_storage:/app/storage
    depends_on:
      chatwoot-db:
        condition: service_healthy
      chatwoot-redis:
        condition: service_healthy

  chatwoot-db:
    image: postgres:16-alpine
    container_name: chatwoot-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: chatwoot
      POSTGRES_PASSWORD: \${DB_PASSWORD:-chatwoot123}
      POSTGRES_DB: chatwoot
    volumes:
      - chatwoot_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U chatwoot"]
      interval: 5s
      timeout: 5s
      retries: 5

  chatwoot-redis:
    image: redis:7-alpine
    container_name: chatwoot-redis
    restart: unless-stopped
    volumes:
      - chatwoot_redis:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  chatwoot_storage:
  chatwoot_pgdata:
  chatwoot_redis:`,
  },
  {
    slug: "wordpress",
    name: "WordPress",
    description: "The most popular CMS in the world",
    icon: "📝",
    category: "CMS",
    tags: ["cms", "blog", "website"],
    website: "https://wordpress.org",
    compose: `services:
  wordpress:
    image: wordpress:latest
    container_name: wordpress
    restart: unless-stopped
    ports:
      - "8080:80"
    environment:
      WORDPRESS_DB_HOST: wordpress-db
      WORDPRESS_DB_USER: wordpress
      WORDPRESS_DB_PASSWORD: \${DB_PASSWORD:-wordpress123}
      WORDPRESS_DB_NAME: wordpress
    volumes:
      - wordpress_data:/var/www/html
    depends_on:
      wordpress-db:
        condition: service_healthy

  wordpress-db:
    image: mariadb:11
    container_name: wordpress-db
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: \${DB_ROOT_PASSWORD:-root123}
      MYSQL_DATABASE: wordpress
      MYSQL_USER: wordpress
      MYSQL_PASSWORD: \${DB_PASSWORD:-wordpress123}
    volumes:
      - wordpress_dbdata:/var/lib/mysql
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  wordpress_data:
  wordpress_dbdata:`,
  },
  {
    slug: "ghost",
    name: "Ghost",
    description: "Professional publishing platform — modern alternative to WordPress",
    icon: "👻",
    category: "CMS",
    tags: ["cms", "blog", "newsletter", "publishing"],
    website: "https://ghost.org",
    compose: `services:
  ghost:
    image: ghost:5-alpine
    container_name: ghost
    restart: unless-stopped
    ports:
      - "2368:2368"
    environment:
      url: \${GHOST_URL:-http://localhost:2368}
      database__client: mysql
      database__connection__host: ghost-db
      database__connection__user: ghost
      database__connection__password: \${DB_PASSWORD:-ghost123}
      database__connection__database: ghost
    volumes:
      - ghost_content:/var/lib/ghost/content
    depends_on:
      ghost-db:
        condition: service_healthy

  ghost-db:
    image: mysql:8.0
    container_name: ghost-db
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: \${DB_ROOT_PASSWORD:-root123}
      MYSQL_DATABASE: ghost
      MYSQL_USER: ghost
      MYSQL_PASSWORD: \${DB_PASSWORD:-ghost123}
    volumes:
      - ghost_dbdata:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  ghost_content:
  ghost_dbdata:`,
  },
  {
    slug: "gitea",
    name: "Gitea",
    description: "Lightweight self-hosted Git service",
    icon: "🍵",
    category: "Development",
    tags: ["git", "repository", "devops", "ci-cd"],
    website: "https://gitea.io",
    compose: `services:
  gitea:
    image: gitea/gitea:latest
    container_name: gitea
    restart: unless-stopped
    ports:
      - "3000:3000"
      - "2222:22"
    environment:
      GITEA__database__DB_TYPE: postgres
      GITEA__database__HOST: gitea-db:5432
      GITEA__database__NAME: gitea
      GITEA__database__USER: gitea
      GITEA__database__PASSWD: \${DB_PASSWORD:-gitea123}
    volumes:
      - gitea_data:/data
    depends_on:
      gitea-db:
        condition: service_healthy

  gitea-db:
    image: postgres:16-alpine
    container_name: gitea-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: gitea
      POSTGRES_PASSWORD: \${DB_PASSWORD:-gitea123}
      POSTGRES_DB: gitea
    volumes:
      - gitea_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U gitea"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  gitea_data:
  gitea_pgdata:`,
  },
  {
    slug: "minio",
    name: "MinIO",
    description: "High-performance S3-compatible object storage",
    icon: "🪣",
    category: "Storage",
    tags: ["storage", "s3", "object-storage", "backup"],
    website: "https://min.io",
    compose: `services:
  minio:
    image: minio/minio:latest
    container_name: minio
    restart: unless-stopped
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ROOT_USER: \${MINIO_USER:-admin}
      MINIO_ROOT_PASSWORD: \${MINIO_PASSWORD:-minio12345}
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data

volumes:
  minio_data:`,
  },
  {
    slug: "portainer",
    name: "Portainer",
    description: "Docker management UI",
    icon: "🐳",
    category: "DevOps",
    tags: ["docker", "management", "containers", "devops"],
    website: "https://portainer.io",
    compose: `services:
  portainer:
    image: portainer/portainer-ce:latest
    container_name: portainer
    restart: unless-stopped
    ports:
      - "9443:9443"
      - "9000:9000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - portainer_data:/data

volumes:
  portainer_data:`,
  },
  {
    slug: "grafana-prometheus",
    name: "Grafana + Prometheus",
    description: "Monitoring stack — metrics collection and dashboards",
    icon: "📊",
    category: "Monitoring",
    tags: ["monitoring", "metrics", "grafana", "prometheus", "dashboards"],
    website: "https://grafana.com",
    compose: `services:
  grafana:
    image: grafana/grafana:latest
    container_name: grafana
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      GF_SECURITY_ADMIN_USER: \${GRAFANA_USER:-admin}
      GF_SECURITY_ADMIN_PASSWORD: \${GRAFANA_PASSWORD:-admin123}
    volumes:
      - grafana_data:/var/lib/grafana

  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    restart: unless-stopped
    ports:
      - "9090:9090"
    volumes:
      - prometheus_data:/prometheus

volumes:
  grafana_data:
  prometheus_data:`,
  },
  {
    slug: "nextcloud",
    name: "Nextcloud",
    description: "Self-hosted file sync, share, and collaboration platform",
    icon: "☁️",
    category: "Storage",
    tags: ["cloud", "files", "sync", "collaboration", "office"],
    website: "https://nextcloud.com",
    compose: `services:
  nextcloud:
    image: nextcloud:latest
    container_name: nextcloud
    restart: unless-stopped
    ports:
      - "8080:80"
    environment:
      POSTGRES_HOST: nextcloud-db
      POSTGRES_DB: nextcloud
      POSTGRES_USER: nextcloud
      POSTGRES_PASSWORD: \${DB_PASSWORD:-nextcloud123}
      REDIS_HOST: nextcloud-redis
    volumes:
      - nextcloud_data:/var/www/html
    depends_on:
      nextcloud-db:
        condition: service_healthy

  nextcloud-db:
    image: postgres:16-alpine
    container_name: nextcloud-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: nextcloud
      POSTGRES_PASSWORD: \${DB_PASSWORD:-nextcloud123}
      POSTGRES_DB: nextcloud
    volumes:
      - nextcloud_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nextcloud"]
      interval: 5s
      timeout: 5s
      retries: 5

  nextcloud-redis:
    image: redis:7-alpine
    container_name: nextcloud-redis
    restart: unless-stopped
    volumes:
      - nextcloud_redis:/data

volumes:
  nextcloud_data:
  nextcloud_pgdata:
  nextcloud_redis:`,
  },
  {
    slug: "plausible",
    name: "Plausible Analytics",
    description: "Privacy-friendly Google Analytics alternative",
    icon: "📈",
    category: "Analytics",
    tags: ["analytics", "privacy", "statistics", "web"],
    website: "https://plausible.io",
    compose: `services:
  plausible:
    image: ghcr.io/plausible/community-edition:latest
    container_name: plausible
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      BASE_URL: \${BASE_URL:-http://localhost:8000}
      SECRET_KEY_BASE: \${SECRET_KEY:-$(openssl rand -base64 48)}
      DATABASE_URL: postgres://plausible:\${DB_PASSWORD:-plausible123}@plausible-db:5432/plausible
      CLICKHOUSE_DATABASE_URL: http://plausible-events:8123/plausible_events
    depends_on:
      plausible-db:
        condition: service_healthy
      plausible-events:
        condition: service_healthy

  plausible-db:
    image: postgres:16-alpine
    container_name: plausible-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: plausible
      POSTGRES_PASSWORD: \${DB_PASSWORD:-plausible123}
      POSTGRES_DB: plausible
    volumes:
      - plausible_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U plausible"]
      interval: 5s
      timeout: 5s
      retries: 5

  plausible-events:
    image: clickhouse/clickhouse-server:latest
    container_name: plausible-events
    restart: unless-stopped
    volumes:
      - plausible_events:/var/lib/clickhouse
    healthcheck:
      test: ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:8123/ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  plausible_pgdata:
  plausible_events:`,
  },
  {
    slug: "vaultwarden",
    name: "Vaultwarden",
    description: "Lightweight Bitwarden-compatible password manager",
    icon: "🔐",
    category: "Security",
    tags: ["password", "security", "vault", "bitwarden"],
    website: "https://github.com/dani-garcia/vaultwarden",
    compose: `services:
  vaultwarden:
    image: vaultwarden/server:latest
    container_name: vaultwarden
    restart: unless-stopped
    ports:
      - "8080:80"
    environment:
      DOMAIN: \${DOMAIN:-http://localhost:8080}
      ADMIN_TOKEN: \${ADMIN_TOKEN:-change-me}
    volumes:
      - vaultwarden_data:/data

volumes:
  vaultwarden_data:`,
  },
  {
    slug: "directus",
    name: "Directus",
    description: "Open data platform — headless CMS and API builder",
    icon: "🐰",
    category: "CMS",
    tags: ["cms", "headless", "api", "database", "admin"],
    website: "https://directus.io",
    compose: `services:
  directus:
    image: directus/directus:latest
    container_name: directus
    restart: unless-stopped
    ports:
      - "8055:8055"
    environment:
      SECRET: \${SECRET:-$(openssl rand -hex 32)}
      DB_CLIENT: pg
      DB_HOST: directus-db
      DB_PORT: "5432"
      DB_DATABASE: directus
      DB_USER: directus
      DB_PASSWORD: \${DB_PASSWORD:-directus123}
      ADMIN_EMAIL: \${ADMIN_EMAIL:-admin@example.com}
      ADMIN_PASSWORD: \${ADMIN_PASSWORD:-admin123}
    volumes:
      - directus_uploads:/directus/uploads
      - directus_extensions:/directus/extensions
    depends_on:
      directus-db:
        condition: service_healthy

  directus-db:
    image: postgres:16-alpine
    container_name: directus-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: directus
      POSTGRES_PASSWORD: \${DB_PASSWORD:-directus123}
      POSTGRES_DB: directus
    volumes:
      - directus_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U directus"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  directus_uploads:
  directus_extensions:
  directus_pgdata:`,
  },
  {
    slug: "appwrite",
    name: "Appwrite",
    description: "Backend-as-a-Service — auth, database, storage, functions",
    icon: "🏗️",
    category: "Development",
    tags: ["backend", "baas", "firebase", "api", "auth"],
    website: "https://appwrite.io",
    compose: `services:
  appwrite:
    image: appwrite/appwrite:latest
    container_name: appwrite
    restart: unless-stopped
    ports:
      - "8080:80"
    environment:
      _APP_ENV: production
      _APP_OPENSSL_KEY_V1: \${OPENSSL_KEY:-$(openssl rand -hex 16)}
      _APP_REDIS_HOST: appwrite-redis
      _APP_DB_HOST: appwrite-db
      _APP_DB_USER: appwrite
      _APP_DB_PASS: \${DB_PASSWORD:-appwrite123}
      _APP_DB_SCHEMA: appwrite
    volumes:
      - appwrite_uploads:/storage/uploads
      - appwrite_cache:/storage/cache
    depends_on:
      - appwrite-db
      - appwrite-redis

  appwrite-db:
    image: mariadb:11
    container_name: appwrite-db
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: \${DB_ROOT_PASSWORD:-root123}
      MYSQL_DATABASE: appwrite
      MYSQL_USER: appwrite
      MYSQL_PASSWORD: \${DB_PASSWORD:-appwrite123}
    volumes:
      - appwrite_dbdata:/var/lib/mysql

  appwrite-redis:
    image: redis:7-alpine
    container_name: appwrite-redis
    restart: unless-stopped
    volumes:
      - appwrite_redis:/data

volumes:
  appwrite_uploads:
  appwrite_cache:
  appwrite_dbdata:
  appwrite_redis:`,
  },
  {
    slug: "immich",
    name: "Immich",
    description: "Self-hosted Google Photos alternative with AI",
    icon: "📸",
    category: "Media",
    tags: ["photos", "gallery", "ai", "backup", "media"],
    website: "https://immich.app",
    compose: `services:
  immich:
    image: ghcr.io/immich-app/immich-server:release
    container_name: immich
    restart: unless-stopped
    ports:
      - "2283:2283"
    environment:
      DB_HOSTNAME: immich-db
      DB_USERNAME: immich
      DB_PASSWORD: \${DB_PASSWORD:-immich123}
      DB_DATABASE_NAME: immich
      REDIS_HOSTNAME: immich-redis
    volumes:
      - immich_upload:/usr/src/app/upload
    depends_on:
      immich-db:
        condition: service_healthy
      immich-redis:
        condition: service_healthy

  immich-db:
    image: tensorchord/pgvecto-rs:pg16-v0.2.0
    container_name: immich-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: immich
      POSTGRES_PASSWORD: \${DB_PASSWORD:-immich123}
      POSTGRES_DB: immich
    volumes:
      - immich_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U immich"]
      interval: 5s
      timeout: 5s
      retries: 5

  immich-redis:
    image: redis:7-alpine
    container_name: immich-redis
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  immich_upload:
  immich_pgdata:`,
  },
  {
    slug: "mattermost",
    name: "Mattermost",
    description: "Open source Slack alternative for team communication",
    icon: "💬",
    category: "Communication",
    tags: ["chat", "team", "slack", "collaboration"],
    website: "https://mattermost.com",
    compose: `services:
  mattermost:
    image: mattermost/mattermost-team-edition:latest
    container_name: mattermost
    restart: unless-stopped
    ports:
      - "8065:8065"
    environment:
      MM_SQLSETTINGS_DRIVERNAME: postgres
      MM_SQLSETTINGS_DATASOURCE: postgres://mattermost:\${DB_PASSWORD:-mattermost123}@mattermost-db:5432/mattermost?sslmode=disable
    volumes:
      - mattermost_data:/mattermost/data
      - mattermost_logs:/mattermost/logs
      - mattermost_config:/mattermost/config
      - mattermost_plugins:/mattermost/plugins
    depends_on:
      mattermost-db:
        condition: service_healthy

  mattermost-db:
    image: postgres:16-alpine
    container_name: mattermost-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: mattermost
      POSTGRES_PASSWORD: \${DB_PASSWORD:-mattermost123}
      POSTGRES_DB: mattermost
    volumes:
      - mattermost_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mattermost"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  mattermost_data:
  mattermost_logs:
  mattermost_config:
  mattermost_plugins:
  mattermost_pgdata:`,
  },
  {
    slug: "outline",
    name: "Outline",
    description: "Wiki and knowledge base for teams — beautiful and fast",
    icon: "📖",
    category: "Productivity",
    tags: ["wiki", "docs", "knowledge-base", "team"],
    website: "https://getoutline.com",
    compose: `services:
  outline:
    image: outlinewiki/outline:latest
    container_name: outline
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      SECRET_KEY: \${SECRET_KEY:-$(openssl rand -hex 32)}
      UTILS_SECRET: \${UTILS_SECRET:-$(openssl rand -hex 32)}
      DATABASE_URL: postgres://outline:\${DB_PASSWORD:-outline123}@outline-db:5432/outline
      REDIS_URL: redis://outline-redis:6379
      URL: \${URL:-http://localhost:3000}
      FILE_STORAGE: local
      FILE_STORAGE_LOCAL_ROOT_DIR: /var/lib/outline/data
    volumes:
      - outline_data:/var/lib/outline/data
    depends_on:
      outline-db:
        condition: service_healthy
      outline-redis:
        condition: service_healthy

  outline-db:
    image: postgres:16-alpine
    container_name: outline-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: outline
      POSTGRES_PASSWORD: \${DB_PASSWORD:-outline123}
      POSTGRES_DB: outline
    volumes:
      - outline_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U outline"]
      interval: 5s
      timeout: 5s
      retries: 5

  outline-redis:
    image: redis:7-alpine
    container_name: outline-redis
    restart: unless-stopped

volumes:
  outline_data:
  outline_pgdata:`,
  },
  {
    slug: "supabase",
    name: "Supabase",
    description: "Open source Firebase alternative — database, auth, storage, edge functions",
    icon: "⚡",
    category: "Development",
    tags: ["backend", "baas", "firebase", "postgres", "api", "auth"],
    website: "https://supabase.com",
    compose: `services:
  supabase-studio:
    image: supabase/studio:latest
    container_name: supabase-studio
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      STUDIO_PG_META_URL: http://supabase-meta:8080
      SUPABASE_URL: http://supabase-kong:8000
      SUPABASE_REST_URL: http://supabase-kong:8000/rest/v1/

  supabase-db:
    image: supabase/postgres:15.6.1.145
    container_name: supabase-db
    restart: unless-stopped
    ports:
      - "5432:5432"
    environment:
      POSTGRES_PASSWORD: \${DB_PASSWORD:-supabase123}
    volumes:
      - supabase_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U supabase_admin"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  supabase_pgdata:`,
  },
  {
    slug: "paperless-ngx",
    name: "Paperless-ngx",
    description: "Document management system — scan, organize, search your papers",
    icon: "📄",
    category: "Productivity",
    tags: ["documents", "scanner", "ocr", "paperless"],
    website: "https://docs.paperless-ngx.com",
    compose: `services:
  paperless:
    image: ghcr.io/paperless-ngx/paperless-ngx:latest
    container_name: paperless
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      PAPERLESS_REDIS: redis://paperless-redis:6379
      PAPERLESS_DBHOST: paperless-db
      PAPERLESS_DBUSER: paperless
      PAPERLESS_DBPASS: \${DB_PASSWORD:-paperless123}
      PAPERLESS_ADMIN_USER: \${ADMIN_USER:-admin}
      PAPERLESS_ADMIN_PASSWORD: \${ADMIN_PASSWORD:-admin123}
    volumes:
      - paperless_data:/usr/src/paperless/data
      - paperless_media:/usr/src/paperless/media
      - paperless_consume:/usr/src/paperless/consume
    depends_on:
      paperless-db:
        condition: service_healthy
      paperless-redis:
        condition: service_healthy

  paperless-db:
    image: postgres:16-alpine
    container_name: paperless-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: paperless
      POSTGRES_PASSWORD: \${DB_PASSWORD:-paperless123}
      POSTGRES_DB: paperless
    volumes:
      - paperless_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U paperless"]
      interval: 5s
      timeout: 5s
      retries: 5

  paperless-redis:
    image: redis:7-alpine
    container_name: paperless-redis
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  paperless_data:
  paperless_media:
  paperless_consume:
  paperless_pgdata:`,
  },
  // ─── AI & Machine Learning ────────────────────────────────
  {
    slug: "ollama-webui",
    name: "Ollama + Open WebUI",
    description: "Run LLMs locally — ChatGPT-like interface with Llama, Mistral, Gemma",
    icon: "🤖",
    category: "AI",
    tags: ["ai", "llm", "chatgpt", "ollama", "machine-learning"],
    website: "https://openwebui.com",
    compose: `services:
  ollama:
    image: ollama/ollama:latest
    container_name: ollama
    restart: unless-stopped
    volumes:
      - ollama_data:/root/.ollama
    deploy:
      resources:
        reservations:
          devices:
            - capabilities: [gpu]

  open-webui:
    image: ghcr.io/open-webui/open-webui:main
    container_name: open-webui
    restart: unless-stopped
    ports:
      - "3000:8080"
    environment:
      OLLAMA_BASE_URL: http://ollama:11434
    volumes:
      - openwebui_data:/app/backend/data
    depends_on:
      - ollama

volumes:
  ollama_data:
  openwebui_data:`,
  },
  {
    slug: "langfuse",
    name: "Langfuse",
    description: "LLM observability — traces, evals, prompt management for AI apps",
    icon: "🔍",
    category: "AI",
    tags: ["ai", "llm", "observability", "tracing", "prompts"],
    website: "https://langfuse.com",
    compose: `services:
  langfuse:
    image: langfuse/langfuse:latest
    container_name: langfuse
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://langfuse:\${DB_PASSWORD:-langfuse123}@langfuse-db:5432/langfuse
      NEXTAUTH_SECRET: \${NEXTAUTH_SECRET:-$(openssl rand -hex 32)}
      NEXTAUTH_URL: \${NEXTAUTH_URL:-http://localhost:3000}
      SALT: \${SALT:-$(openssl rand -hex 16)}
    depends_on:
      langfuse-db:
        condition: service_healthy

  langfuse-db:
    image: postgres:16-alpine
    container_name: langfuse-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: langfuse
      POSTGRES_PASSWORD: \${DB_PASSWORD:-langfuse123}
      POSTGRES_DB: langfuse
    volumes:
      - langfuse_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U langfuse"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  langfuse_pgdata:`,
  },
  {
    slug: "flowise",
    name: "Flowise",
    description: "Drag & drop LLM flow builder — build AI agents visually",
    icon: "🌊",
    category: "AI",
    tags: ["ai", "llm", "no-code", "agents", "langchain"],
    website: "https://flowiseai.com",
    compose: `services:
  flowise:
    image: flowiseai/flowise:latest
    container_name: flowise
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      FLOWISE_USERNAME: \${FLOWISE_USER:-admin}
      FLOWISE_PASSWORD: \${FLOWISE_PASS:-admin123}
    volumes:
      - flowise_data:/root/.flowise

volumes:
  flowise_data:`,
  },
  // ─── Communication ────────────────────────────────────────
  {
    slug: "rocket-chat",
    name: "Rocket.Chat",
    description: "Team communication platform — Slack alternative with omnichannel",
    icon: "🚀",
    category: "Communication",
    tags: ["chat", "team", "slack", "omnichannel"],
    website: "https://rocket.chat",
    compose: `services:
  rocketchat:
    image: registry.rocket.chat/rocketchat/rocket.chat:latest
    container_name: rocketchat
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      MONGO_URL: mongodb://rocketchat-mongo:27017/rocketchat?replicaSet=rs0
      MONGO_OPLOG_URL: mongodb://rocketchat-mongo:27017/local?replicaSet=rs0
      ROOT_URL: \${ROOT_URL:-http://localhost:3000}
      PORT: "3000"
    depends_on:
      - rocketchat-mongo
    volumes:
      - rocketchat_uploads:/app/uploads

  rocketchat-mongo:
    image: mongo:6.0
    container_name: rocketchat-mongo
    restart: unless-stopped
    command: mongod --oplogSize 128 --replSet rs0
    volumes:
      - rocketchat_mongo:/data/db

volumes:
  rocketchat_uploads:
  rocketchat_mongo:`,
  },
  {
    slug: "typebot",
    name: "Typebot",
    description: "Beautiful conversational forms and chatbot builder",
    icon: "🤖",
    category: "Communication",
    tags: ["chatbot", "forms", "no-code", "conversational"],
    website: "https://typebot.io",
    compose: `services:
  typebot-builder:
    image: baptistearno/typebot-builder:latest
    container_name: typebot-builder
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://typebot:\${DB_PASSWORD:-typebot123}@typebot-db:5432/typebot
      NEXTAUTH_URL: \${NEXTAUTH_URL:-http://localhost:3000}
      NEXT_PUBLIC_VIEWER_URL: \${VIEWER_URL:-http://localhost:3001}
      ENCRYPTION_SECRET: \${ENCRYPTION_SECRET:-$(openssl rand -hex 16)}
      NEXTAUTH_SECRET: \${NEXTAUTH_SECRET:-$(openssl rand -hex 32)}
      ADMIN_EMAIL: \${ADMIN_EMAIL:-admin@example.com}
    depends_on:
      typebot-db:
        condition: service_healthy

  typebot-viewer:
    image: baptistearno/typebot-viewer:latest
    container_name: typebot-viewer
    restart: unless-stopped
    ports:
      - "3001:3000"
    environment:
      DATABASE_URL: postgresql://typebot:\${DB_PASSWORD:-typebot123}@typebot-db:5432/typebot
      NEXTAUTH_URL: \${NEXTAUTH_URL:-http://localhost:3000}
      NEXT_PUBLIC_VIEWER_URL: \${VIEWER_URL:-http://localhost:3001}
      ENCRYPTION_SECRET: \${ENCRYPTION_SECRET:-$(openssl rand -hex 16)}

  typebot-db:
    image: postgres:16-alpine
    container_name: typebot-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: typebot
      POSTGRES_PASSWORD: \${DB_PASSWORD:-typebot123}
      POSTGRES_DB: typebot
    volumes:
      - typebot_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U typebot"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  typebot_pgdata:`,
  },
  // ─── Development ──────────────────────────────────────────
  {
    slug: "gitlab",
    name: "GitLab CE",
    description: "Complete DevOps platform — Git, CI/CD, registry, wiki, issues",
    icon: "🦊",
    category: "Development",
    tags: ["git", "ci-cd", "devops", "registry"],
    website: "https://about.gitlab.com",
    compose: `services:
  gitlab:
    image: gitlab/gitlab-ce:latest
    container_name: gitlab
    restart: unless-stopped
    ports:
      - "8080:80"
      - "8443:443"
      - "2222:22"
    environment:
      GITLAB_OMNIBUS_CONFIG: |
        external_url '\${GITLAB_URL:-http://localhost:8080}'
        gitlab_rails['gitlab_shell_ssh_port'] = 2222
    volumes:
      - gitlab_config:/etc/gitlab
      - gitlab_logs:/var/log/gitlab
      - gitlab_data:/var/opt/gitlab
    shm_size: "256m"

volumes:
  gitlab_config:
  gitlab_logs:
  gitlab_data:`,
  },
  {
    slug: "drone",
    name: "Drone CI",
    description: "Container-native CI/CD platform — automate build, test, deploy",
    icon: "🐝",
    category: "Development",
    tags: ["ci-cd", "automation", "devops", "pipelines"],
    website: "https://drone.io",
    compose: `services:
  drone:
    image: drone/drone:latest
    container_name: drone
    restart: unless-stopped
    ports:
      - "8080:80"
    environment:
      DRONE_GITEA_SERVER: \${GITEA_URL:-http://gitea:3000}
      DRONE_RPC_SECRET: \${RPC_SECRET:-$(openssl rand -hex 16)}
      DRONE_SERVER_HOST: \${DRONE_HOST:-localhost:8080}
      DRONE_SERVER_PROTO: http
    volumes:
      - drone_data:/data

  drone-runner:
    image: drone/drone-runner-docker:latest
    container_name: drone-runner
    restart: unless-stopped
    environment:
      DRONE_RPC_PROTO: http
      DRONE_RPC_HOST: drone
      DRONE_RPC_SECRET: \${RPC_SECRET:-$(openssl rand -hex 16)}
      DRONE_RUNNER_CAPACITY: "2"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock

volumes:
  drone_data:`,
  },
  {
    slug: "harbor",
    name: "Harbor",
    description: "Enterprise container registry with vulnerability scanning",
    icon: "⚓",
    category: "DevOps",
    tags: ["registry", "docker", "containers", "security"],
    website: "https://goharbor.io",
    compose: `services:
  harbor:
    image: goharbor/harbor-core:latest
    container_name: harbor
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - harbor_data:/data

volumes:
  harbor_data:`,
  },
  // ─── Database ─────────────────────────────────────────────
  {
    slug: "pgadmin",
    name: "pgAdmin",
    description: "PostgreSQL admin and management UI",
    icon: "🐘",
    category: "Database",
    tags: ["database", "postgres", "admin", "sql"],
    website: "https://pgadmin.org",
    compose: `services:
  pgadmin:
    image: dpage/pgadmin4:latest
    container_name: pgadmin
    restart: unless-stopped
    ports:
      - "5050:80"
    environment:
      PGADMIN_DEFAULT_EMAIL: \${ADMIN_EMAIL:-admin@example.com}
      PGADMIN_DEFAULT_PASSWORD: \${ADMIN_PASSWORD:-admin123}
    volumes:
      - pgadmin_data:/var/lib/pgadmin

volumes:
  pgadmin_data:`,
  },
  {
    slug: "mongo-express",
    name: "MongoDB + Mongo Express",
    description: "MongoDB database with web-based admin UI",
    icon: "🍃",
    category: "Database",
    tags: ["database", "mongodb", "nosql", "admin"],
    website: "https://github.com/mongo-express/mongo-express",
    compose: `services:
  mongo:
    image: mongo:7
    container_name: mongo
    restart: unless-stopped
    environment:
      MONGO_INITDB_ROOT_USERNAME: \${MONGO_USER:-admin}
      MONGO_INITDB_ROOT_PASSWORD: \${MONGO_PASSWORD:-mongo123}
    volumes:
      - mongo_data:/data/db

  mongo-express:
    image: mongo-express:latest
    container_name: mongo-express
    restart: unless-stopped
    ports:
      - "8081:8081"
    environment:
      ME_CONFIG_MONGODB_ADMINUSERNAME: \${MONGO_USER:-admin}
      ME_CONFIG_MONGODB_ADMINPASSWORD: \${MONGO_PASSWORD:-mongo123}
      ME_CONFIG_MONGODB_URL: mongodb://\${MONGO_USER:-admin}:\${MONGO_PASSWORD:-mongo123}@mongo:27017/
    depends_on:
      - mongo

volumes:
  mongo_data:`,
  },
  // ─── Media ────────────────────────────────────────────────
  {
    slug: "jellyfin",
    name: "Jellyfin",
    description: "Free media streaming server — movies, TV, music",
    icon: "🎬",
    category: "Media",
    tags: ["media", "streaming", "movies", "tv", "music"],
    website: "https://jellyfin.org",
    compose: `services:
  jellyfin:
    image: jellyfin/jellyfin:latest
    container_name: jellyfin
    restart: unless-stopped
    ports:
      - "8096:8096"
    volumes:
      - jellyfin_config:/config
      - jellyfin_cache:/cache
      - \${MEDIA_PATH:-/srv/media}:/media

volumes:
  jellyfin_config:
  jellyfin_cache:`,
  },
  {
    slug: "audiobookshelf",
    name: "Audiobookshelf",
    description: "Self-hosted audiobook and podcast server",
    icon: "🎧",
    category: "Media",
    tags: ["audiobooks", "podcasts", "media", "streaming"],
    website: "https://audiobookshelf.org",
    compose: `services:
  audiobookshelf:
    image: ghcr.io/advplyr/audiobookshelf:latest
    container_name: audiobookshelf
    restart: unless-stopped
    ports:
      - "13378:80"
    volumes:
      - audiobookshelf_config:/config
      - audiobookshelf_metadata:/metadata
      - \${AUDIOBOOKS_PATH:-/srv/audiobooks}:/audiobooks
      - \${PODCASTS_PATH:-/srv/podcasts}:/podcasts

volumes:
  audiobookshelf_config:
  audiobookshelf_metadata:`,
  },
  // ─── ERP / Business ───────────────────────────────────────
  {
    slug: "erpnext",
    name: "ERPNext",
    description: "Full-featured ERP — accounting, HR, CRM, manufacturing, inventory",
    icon: "🏢",
    category: "Business",
    tags: ["erp", "accounting", "crm", "hr", "inventory"],
    website: "https://erpnext.com",
    compose: `services:
  erpnext:
    image: frappe/erpnext:latest
    container_name: erpnext
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      DB_HOST: erpnext-db
      DB_PORT: "3306"
      REDIS_CACHE: redis://erpnext-redis:6379/0
      REDIS_QUEUE: redis://erpnext-redis:6379/1
      SOCKETIO_PORT: "9000"
    volumes:
      - erpnext_sites:/home/frappe/frappe-bench/sites
    depends_on:
      - erpnext-db
      - erpnext-redis

  erpnext-db:
    image: mariadb:11
    container_name: erpnext-db
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: \${DB_ROOT_PASSWORD:-root123}
      MYSQL_DATABASE: erpnext
    command: --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
    volumes:
      - erpnext_dbdata:/var/lib/mysql

  erpnext-redis:
    image: redis:7-alpine
    container_name: erpnext-redis
    restart: unless-stopped

volumes:
  erpnext_sites:
  erpnext_dbdata:`,
  },
  {
    slug: "invoiceninja",
    name: "Invoice Ninja",
    description: "Invoicing, payments, expenses and time-tracking",
    icon: "💰",
    category: "Business",
    tags: ["invoice", "payments", "billing", "accounting"],
    website: "https://invoiceninja.com",
    compose: `services:
  invoiceninja:
    image: invoiceninja/invoiceninja:latest
    container_name: invoiceninja
    restart: unless-stopped
    ports:
      - "8080:80"
    environment:
      APP_URL: \${APP_URL:-http://localhost:8080}
      APP_KEY: \${APP_KEY:-base64:$(openssl rand -base64 32)}
      DB_HOST: invoiceninja-db
      DB_DATABASE: invoiceninja
      DB_USERNAME: invoiceninja
      DB_PASSWORD: \${DB_PASSWORD:-ninja123}
    volumes:
      - invoiceninja_public:/var/www/app/public
      - invoiceninja_storage:/var/www/app/storage
    depends_on:
      invoiceninja-db:
        condition: service_healthy

  invoiceninja-db:
    image: mariadb:11
    container_name: invoiceninja-db
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: \${DB_ROOT_PASSWORD:-root123}
      MYSQL_DATABASE: invoiceninja
      MYSQL_USER: invoiceninja
      MYSQL_PASSWORD: \${DB_PASSWORD:-ninja123}
    volumes:
      - invoiceninja_dbdata:/var/lib/mysql
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  invoiceninja_public:
  invoiceninja_storage:
  invoiceninja_dbdata:`,
  },
  // ─── Security ─────────────────────────────────────────────
  {
    slug: "authentik",
    name: "Authentik",
    description: "Identity provider — SSO, OAuth2, SAML, LDAP, MFA",
    icon: "🛡️",
    category: "Security",
    tags: ["auth", "sso", "oauth", "ldap", "identity"],
    website: "https://goauthentik.io",
    compose: `services:
  authentik-server:
    image: ghcr.io/goauthentik/server:latest
    container_name: authentik-server
    restart: unless-stopped
    command: server
    ports:
      - "9000:9000"
      - "9443:9443"
    environment:
      AUTHENTIK_SECRET_KEY: \${AUTHENTIK_SECRET:-$(openssl rand -hex 32)}
      AUTHENTIK_REDIS__HOST: authentik-redis
      AUTHENTIK_POSTGRESQL__HOST: authentik-db
      AUTHENTIK_POSTGRESQL__USER: authentik
      AUTHENTIK_POSTGRESQL__PASSWORD: \${DB_PASSWORD:-authentik123}
      AUTHENTIK_POSTGRESQL__NAME: authentik
    depends_on:
      authentik-db:
        condition: service_healthy
      authentik-redis:
        condition: service_healthy

  authentik-worker:
    image: ghcr.io/goauthentik/server:latest
    container_name: authentik-worker
    restart: unless-stopped
    command: worker
    environment:
      AUTHENTIK_SECRET_KEY: \${AUTHENTIK_SECRET:-$(openssl rand -hex 32)}
      AUTHENTIK_REDIS__HOST: authentik-redis
      AUTHENTIK_POSTGRESQL__HOST: authentik-db
      AUTHENTIK_POSTGRESQL__USER: authentik
      AUTHENTIK_POSTGRESQL__PASSWORD: \${DB_PASSWORD:-authentik123}
      AUTHENTIK_POSTGRESQL__NAME: authentik
    depends_on:
      authentik-db:
        condition: service_healthy
      authentik-redis:
        condition: service_healthy

  authentik-db:
    image: postgres:16-alpine
    container_name: authentik-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: authentik
      POSTGRES_PASSWORD: \${DB_PASSWORD:-authentik123}
      POSTGRES_DB: authentik
    volumes:
      - authentik_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U authentik"]
      interval: 5s
      timeout: 5s
      retries: 5

  authentik-redis:
    image: redis:7-alpine
    container_name: authentik-redis
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  authentik_pgdata:`,
  },
  {
    slug: "crowdsec",
    name: "CrowdSec",
    description: "Collaborative security engine — block malicious IPs",
    icon: "🛡️",
    category: "Security",
    tags: ["security", "firewall", "ids", "protection"],
    website: "https://crowdsec.net",
    compose: `services:
  crowdsec:
    image: crowdsecurity/crowdsec:latest
    container_name: crowdsec
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      COLLECTIONS: "crowdsecurity/linux crowdsecurity/nginx"
    volumes:
      - crowdsec_config:/etc/crowdsec
      - crowdsec_data:/var/lib/crowdsec/data
      - /var/log:/var/log:ro

volumes:
  crowdsec_config:
  crowdsec_data:`,
  },
  // ─── Monitoring ───────────────────────────────────────────
  {
    slug: "netdata",
    name: "Netdata",
    description: "Real-time performance and health monitoring for systems and apps",
    icon: "📊",
    category: "Monitoring",
    tags: ["monitoring", "metrics", "dashboards", "real-time"],
    website: "https://netdata.cloud",
    compose: `services:
  netdata:
    image: netdata/netdata:latest
    container_name: netdata
    restart: unless-stopped
    ports:
      - "19999:19999"
    cap_add:
      - SYS_PTRACE
      - SYS_ADMIN
    security_opt:
      - apparmor:unconfined
    volumes:
      - netdata_config:/etc/netdata
      - netdata_lib:/var/lib/netdata
      - netdata_cache:/var/cache/netdata
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro

volumes:
  netdata_config:
  netdata_lib:
  netdata_cache:`,
  },
  {
    slug: "loki-grafana",
    name: "Grafana + Loki + Promtail",
    description: "Log aggregation stack — collect, query and visualize logs",
    icon: "📋",
    category: "Monitoring",
    tags: ["logs", "grafana", "loki", "monitoring"],
    website: "https://grafana.com/oss/loki",
    compose: `services:
  grafana:
    image: grafana/grafana:latest
    container_name: grafana-logs
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      GF_SECURITY_ADMIN_PASSWORD: \${GRAFANA_PASSWORD:-admin123}
    volumes:
      - grafana_logs_data:/var/lib/grafana

  loki:
    image: grafana/loki:latest
    container_name: loki
    restart: unless-stopped
    ports:
      - "3100:3100"
    volumes:
      - loki_data:/loki

  promtail:
    image: grafana/promtail:latest
    container_name: promtail
    restart: unless-stopped
    volumes:
      - /var/log:/var/log:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro

volumes:
  grafana_logs_data:
  loki_data:`,
  },
  // ─── Automation ───────────────────────────────────────────
  {
    slug: "activepieces",
    name: "Activepieces",
    description: "No-code automation — open source Zapier alternative",
    icon: "🧩",
    category: "Automation",
    tags: ["automation", "zapier", "no-code", "integration"],
    website: "https://activepieces.com",
    compose: `services:
  activepieces:
    image: activepieces/activepieces:latest
    container_name: activepieces
    restart: unless-stopped
    ports:
      - "8080:80"
    environment:
      AP_ENGINE_EXECUTABLE_PATH: dist/packages/engine/main.js
      AP_ENCRYPTION_KEY: \${ENCRYPTION_KEY:-$(openssl rand -hex 16)}
      AP_JWT_SECRET: \${JWT_SECRET:-$(openssl rand -hex 32)}
      AP_FRONTEND_URL: \${FRONTEND_URL:-http://localhost:8080}
      AP_POSTGRES_DATABASE: activepieces
      AP_POSTGRES_HOST: activepieces-db
      AP_POSTGRES_PORT: "5432"
      AP_POSTGRES_USERNAME: activepieces
      AP_POSTGRES_PASSWORD: \${DB_PASSWORD:-activepieces123}
      AP_REDIS_HOST: activepieces-redis
      AP_REDIS_PORT: "6379"
    depends_on:
      activepieces-db:
        condition: service_healthy
      activepieces-redis:
        condition: service_healthy

  activepieces-db:
    image: postgres:16-alpine
    container_name: activepieces-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: activepieces
      POSTGRES_PASSWORD: \${DB_PASSWORD:-activepieces123}
      POSTGRES_DB: activepieces
    volumes:
      - activepieces_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U activepieces"]
      interval: 5s
      timeout: 5s
      retries: 5

  activepieces-redis:
    image: redis:7-alpine
    container_name: activepieces-redis
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  activepieces_pgdata:`,
  },
  {
    slug: "windmill",
    name: "Windmill",
    description: "Developer platform for scripts, workflows, and UIs — open source Retool",
    icon: "🌀",
    category: "Automation",
    tags: ["automation", "scripts", "workflows", "retool", "internal-tools"],
    website: "https://windmill.dev",
    compose: `services:
  windmill:
    image: ghcr.io/windmill-labs/windmill:main
    container_name: windmill
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgres://windmill:\${DB_PASSWORD:-windmill123}@windmill-db/windmill
      MODE: standalone
    depends_on:
      windmill-db:
        condition: service_healthy

  windmill-db:
    image: postgres:16-alpine
    container_name: windmill-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: windmill
      POSTGRES_PASSWORD: \${DB_PASSWORD:-windmill123}
      POSTGRES_DB: windmill
    volumes:
      - windmill_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U windmill"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  windmill_pgdata:`,
  },
  // ─── CMS / Website builders ───────────────────────────────
  {
    slug: "strapi",
    name: "Strapi",
    description: "Headless CMS — build APIs in minutes, fully customizable",
    icon: "🚀",
    category: "CMS",
    tags: ["cms", "headless", "api", "content"],
    website: "https://strapi.io",
    compose: `services:
  strapi:
    image: strapi/strapi:latest
    container_name: strapi
    restart: unless-stopped
    ports:
      - "1337:1337"
    environment:
      DATABASE_CLIENT: postgres
      DATABASE_HOST: strapi-db
      DATABASE_NAME: strapi
      DATABASE_USERNAME: strapi
      DATABASE_PASSWORD: \${DB_PASSWORD:-strapi123}
    volumes:
      - strapi_data:/srv/app
    depends_on:
      strapi-db:
        condition: service_healthy

  strapi-db:
    image: postgres:16-alpine
    container_name: strapi-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: strapi
      POSTGRES_PASSWORD: \${DB_PASSWORD:-strapi123}
      POSTGRES_DB: strapi
    volumes:
      - strapi_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U strapi"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  strapi_data:
  strapi_pgdata:`,
  },
  {
    slug: "umami",
    name: "Umami",
    description: "Simple, fast, privacy-focused web analytics",
    icon: "📈",
    category: "Analytics",
    tags: ["analytics", "privacy", "web", "statistics"],
    website: "https://umami.is",
    compose: `services:
  umami:
    image: ghcr.io/umami-software/umami:postgresql-latest
    container_name: umami
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://umami:\${DB_PASSWORD:-umami123}@umami-db:5432/umami
    depends_on:
      umami-db:
        condition: service_healthy

  umami-db:
    image: postgres:16-alpine
    container_name: umami-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: umami
      POSTGRES_PASSWORD: \${DB_PASSWORD:-umami123}
      POSTGRES_DB: umami
    volumes:
      - umami_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U umami"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  umami_pgdata:`,
  },
  // ─── Networking / VPN ─────────────────────────────────────
  {
    slug: "wireguard",
    name: "WireGuard VPN",
    description: "Modern, fast VPN tunnel with easy peer management",
    icon: "🔒",
    category: "Networking",
    tags: ["vpn", "wireguard", "tunnel", "security"],
    website: "https://wireguard.com",
    compose: `services:
  wireguard:
    image: lscr.io/linuxserver/wireguard:latest
    container_name: wireguard
    restart: unless-stopped
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    ports:
      - "51820:51820/udp"
    environment:
      PUID: "1000"
      PGID: "1000"
      TZ: \${TZ:-America/Sao_Paulo}
      SERVERURL: \${SERVER_URL:-auto}
      PEERS: \${PEERS:-3}
      PEERDNS: auto
    volumes:
      - wireguard_config:/config
      - /lib/modules:/lib/modules:ro
    sysctls:
      - net.ipv4.conf.all.src_valid_mark=1

volumes:
  wireguard_config:`,
  },
  {
    slug: "nginx-proxy-manager",
    name: "Nginx Proxy Manager",
    description: "Easy reverse proxy with free SSL — GUI for Nginx",
    icon: "🌐",
    category: "Networking",
    tags: ["proxy", "nginx", "ssl", "reverse-proxy"],
    website: "https://nginxproxymanager.com",
    compose: `services:
  npm:
    image: jc21/nginx-proxy-manager:latest
    container_name: nginx-proxy-manager
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "81:81"
    volumes:
      - npm_data:/data
      - npm_letsencrypt:/etc/letsencrypt

volumes:
  npm_data:
  npm_letsencrypt:`,
  },
  // ─── E-commerce ───────────────────────────────────────────
  {
    slug: "medusa",
    name: "Medusa",
    description: "Open source Shopify alternative — headless e-commerce",
    icon: "🛒",
    category: "E-commerce",
    tags: ["ecommerce", "shop", "store", "headless"],
    website: "https://medusajs.com",
    compose: `services:
  medusa:
    image: medusajs/medusa:latest
    container_name: medusa
    restart: unless-stopped
    ports:
      - "9000:9000"
    environment:
      DATABASE_URL: postgres://medusa:\${DB_PASSWORD:-medusa123}@medusa-db/medusa
      REDIS_URL: redis://medusa-redis:6379
      JWT_SECRET: \${JWT_SECRET:-$(openssl rand -hex 32)}
      COOKIE_SECRET: \${COOKIE_SECRET:-$(openssl rand -hex 32)}
    depends_on:
      medusa-db:
        condition: service_healthy
      medusa-redis:
        condition: service_healthy

  medusa-db:
    image: postgres:16-alpine
    container_name: medusa-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: medusa
      POSTGRES_PASSWORD: \${DB_PASSWORD:-medusa123}
      POSTGRES_DB: medusa
    volumes:
      - medusa_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U medusa"]
      interval: 5s
      timeout: 5s
      retries: 5

  medusa-redis:
    image: redis:7-alpine
    container_name: medusa-redis
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  medusa_pgdata:`,
  },
  // ─── Misc ─────────────────────────────────────────────────
  {
    slug: "homepage",
    name: "Homepage",
    description: "Modern dashboard with service integrations and bookmarks",
    icon: "🏠",
    category: "Productivity",
    tags: ["dashboard", "homepage", "bookmarks", "startpage"],
    website: "https://gethomepage.dev",
    compose: `services:
  homepage:
    image: ghcr.io/gethomepage/homepage:latest
    container_name: homepage
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - homepage_config:/app/config
      - /var/run/docker.sock:/var/run/docker.sock:ro

volumes:
  homepage_config:`,
  },
  {
    slug: "linkwarden",
    name: "Linkwarden",
    description: "Bookmark manager with archiving — save, organize, share links",
    icon: "🔗",
    category: "Productivity",
    tags: ["bookmarks", "links", "archive", "organize"],
    website: "https://linkwarden.app",
    compose: `services:
  linkwarden:
    image: ghcr.io/linkwarden/linkwarden:latest
    container_name: linkwarden
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://linkwarden:\${DB_PASSWORD:-linkwarden123}@linkwarden-db:5432/linkwarden
      NEXTAUTH_SECRET: \${NEXTAUTH_SECRET:-$(openssl rand -hex 32)}
      NEXTAUTH_URL: \${NEXTAUTH_URL:-http://localhost:3000}
    depends_on:
      linkwarden-db:
        condition: service_healthy

  linkwarden-db:
    image: postgres:16-alpine
    container_name: linkwarden-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: linkwarden
      POSTGRES_PASSWORD: \${DB_PASSWORD:-linkwarden123}
      POSTGRES_DB: linkwarden
    volumes:
      - linkwarden_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U linkwarden"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  linkwarden_pgdata:`,
  },
  {
    slug: "maybe",
    name: "Maybe",
    description: "Personal finance management — track net worth, investments, spending",
    icon: "💵",
    category: "Business",
    tags: ["finance", "money", "budget", "investments"],
    website: "https://maybe.co",
    compose: `services:
  maybe:
    image: ghcr.io/maybe-finance/maybe:latest
    container_name: maybe
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      SECRET_KEY_BASE: \${SECRET_KEY:-$(openssl rand -hex 64)}
      DB_HOST: maybe-db
      POSTGRES_DB: maybe
      POSTGRES_USER: maybe
      POSTGRES_PASSWORD: \${DB_PASSWORD:-maybe123}
    depends_on:
      maybe-db:
        condition: service_healthy

  maybe-db:
    image: postgres:16-alpine
    container_name: maybe-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: maybe
      POSTGRES_PASSWORD: \${DB_PASSWORD:-maybe123}
      POSTGRES_DB: maybe
    volumes:
      - maybe_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U maybe"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  maybe_pgdata:`,
  },
  {
    slug: "cal-com",
    name: "Cal.com",
    description: "Open source Calendly alternative — scheduling infrastructure",
    icon: "📅",
    category: "Productivity",
    tags: ["calendar", "scheduling", "booking", "calendly"],
    website: "https://cal.com",
    compose: `services:
  calcom:
    image: calcom/cal.com:latest
    container_name: calcom
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://calcom:\${DB_PASSWORD:-calcom123}@calcom-db:5432/calcom
      NEXTAUTH_SECRET: \${NEXTAUTH_SECRET:-$(openssl rand -hex 32)}
      CALENDSO_ENCRYPTION_KEY: \${ENCRYPTION_KEY:-$(openssl rand -hex 16)}
      NEXT_PUBLIC_WEBAPP_URL: \${WEBAPP_URL:-http://localhost:3000}
    depends_on:
      calcom-db:
        condition: service_healthy

  calcom-db:
    image: postgres:16-alpine
    container_name: calcom-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: calcom
      POSTGRES_PASSWORD: \${DB_PASSWORD:-calcom123}
      POSTGRES_DB: calcom
    volumes:
      - calcom_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U calcom"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  calcom_pgdata:`,
  },
];

export const STACK_CATEGORIES = [
  { key: "", label: "All", icon: "🔥" },
  { key: "AI", label: "AI & ML", icon: "🤖" },
  { key: "Automation", label: "Automation", icon: "🔄" },
  { key: "Analytics", label: "Analytics", icon: "📈" },
  { key: "Business", label: "Business", icon: "🏢" },
  { key: "CMS", label: "CMS", icon: "📝" },
  { key: "Communication", label: "Communication", icon: "💬" },
  { key: "Database", label: "Database", icon: "🗄️" },
  { key: "Development", label: "Development", icon: "🛠️" },
  { key: "DevOps", label: "DevOps", icon: "🐳" },
  { key: "E-commerce", label: "E-commerce", icon: "🛒" },
  { key: "Media", label: "Media", icon: "📸" },
  { key: "Monitoring", label: "Monitoring", icon: "📊" },
  { key: "Networking", label: "Networking", icon: "🌐" },
  { key: "Productivity", label: "Productivity", icon: "📋" },
  { key: "Security", label: "Security", icon: "🔐" },
  { key: "Storage", label: "Storage", icon: "☁️" },
];
