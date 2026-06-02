#!/usr/bin/env python3
"""
Bootstrap script — recreates the full MAINTAI_BASE project.

Usage:
    python bootstrap_maintai_base.py [--output /path/to/output]

Default output: ./MAINTAI_BASE (next to this script)

Steps after running:
    cd MAINTAI_BASE
    git remote add origin https://github.com/alexMaster9982/MAINTAI_BASE.git
    git push -u origin main
"""

import argparse
import subprocess
import sys
from pathlib import Path

FILES: dict[str, str] = {}

# ─── Root files ───────────────────────────────────────────────────────────────

FILES["VERSION"] = "1.0.0\n"

FILES[".gitignore"] = """\
# Python
__pycache__/
*.py[cod]
*.pyo
*.pyd
.Python
*.egg-info/
dist/
build/
.eggs/
.venv/
venv/
env/
*.egg
.mypy_cache/
.pytest_cache/
.ruff_cache/

# Environment
.env
.env.local
.env.*.local
backend/.env

# Database
*.db
*.sqlite3

# Node / Next.js
frontend/node_modules/
frontend/.next/
frontend/out/
frontend/.turbo/

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo

# Logs
*.log
logs/

# Uploads / media
backend/uploads/
"""

FILES[".env.example"] = """\
# ─── Backend ────────────────────────────────────────────────────────────────
SECRET_KEY=change-me-in-production-use-openssl-rand-hex-32
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440

# Database
DATABASE_URL=postgresql://maintai:maintai@localhost:5432/maintai
DEMO_DATABASE_URL=sqlite:///./demo.db

# OpenAI (required only if MaintAI module is active)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini

# CORS
CORS_ORIGINS=http://localhost:3000,https://yourdomain.com

# File storage (local or supabase)
STORAGE_BACKEND=local
SUPABASE_URL=
SUPABASE_SERVICE_KEY=

# Email polling (required only if notifications module is active)
IMAP_HOST=
IMAP_PORT=993
IMAP_USER=
IMAP_PASSWORD=

# ─── Frontend ────────────────────────────────────────────────────────────────
NEXT_PUBLIC_API_BASE=http://localhost:8000
"""

FILES["README.md"] = """\
# MaintAI Base

Industrial maintenance management platform — modular, multi-tenant, AI-ready.

## Architecture

MaintAI Base uses a **Modular Monolith** pattern with per-tenant feature flags.
Each module can be independently activated for a client without code changes.

### Modules

| # | Module | Depends on | Default |
|---|--------|-----------|-------|
| 1 | **Base** — Tickets, Sites, Plants, Assets | — | Always ON |
| 2 | **Piani Manutenzione** — maintenance plans | Base | OFF |
| 3 | **Scadenze** — deadlines linked to plans | Base + Piani | OFF |
| 4 | **Scheduling** — calendar, Gantt, Kanban | Base + Tecnici | OFF |
| 5 | **Tecnici** — technician registry, skills, absences | Base | OFF |
| 6 | **Mobile** — smartphone-optimized views | Base | OFF |
| ⦿ | **MaintAI** — AI assistant, RCA, planner GPT | Base | OFF |

## Stack

- **Backend**: FastAPI · SQLAlchemy · Alembic · PostgreSQL / SQLite
- **Frontend**: Next.js 15 · TypeScript · Tailwind v4 · shadcn/ui
- **AI**: OpenAI gpt-4.1-mini (MaintAI module only)
- **Deploy**: Render (backend) · Vercel (frontend)

## Quick start

```bash
# 1. Clone and configure
cp .env.example .env
# Edit .env with your values

# 2. Start with Docker
docker compose up -d

# 3. Or run locally
# Backend
cd backend
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload

# Frontend
cd frontend
npm install
npm run dev
```

## Feature flags

Modules are activated per tenant via the `features` JSON field on the `Tenant` model.

```python
tenant.features = {
    "base": True,
    "piani": True,
    "scadenze": False,
    "scheduling": False,
    "tecnici": True,
    "mobile": False,
    "maintai": False,
}
```

API endpoints for inactive modules return `403 Modulo non attivato`.
Frontend navigation hides inactive module links automatically.
"""

FILES["CHANGELOG.md"] = """\
# Changelog

All notable changes to MaintAI Base will be documented in this file.

## [1.0.0] - 2026-06-02

### Added
- Initial project structure with modular feature-based architecture
- Core authentication system (JWT)
- Feature flag system with per-tenant activation
- Module 1 — Base: Tickets, Sites, Plants, Assets
- Module 2 — Piani Manutenzione (skeleton)
- Module 3 — Scadenze (skeleton)
- Module 4 — Scheduling (skeleton)
- Module 5 — Tecnici (skeleton)
- Module 6 — Mobile (skeleton)
- MaintAI AI overlay (skeleton)
- Docker Compose for local development
- Alembic migrations setup
"""

FILES["docker-compose.yml"] = """\
version: \"3.9\"

services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: maintai
      POSTGRES_PASSWORD: maintai
      POSTGRES_DB: maintai
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - \"5432:5432\"
    healthcheck:
      test: [\"CMD-SHELL\", \"pg_isready -U maintai\"]
      interval: 5s
      timeout: 5s
      retries: 5

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    restart: unless-stopped
    env_file: .env
    environment:
      DATABASE_URL: postgresql://maintai:maintai@db:5432/maintai
    ports:
      - \"8000:8000\"
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - ./backend:/app
      - uploads_data:/app/uploads

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    restart: unless-stopped
    env_file: .env
    environment:
      NEXT_PUBLIC_API_BASE: http://localhost:8000
    ports:
      - \"3000:3000\"
    depends_on:
      - backend

volumes:
  postgres_data:
  uploads_data:
"""

FILES["docs/architecture.md"] = """\
# Architettura MaintAI Base

## Pattern: Modular Monolith + Feature Flags

MaintAI Base e un monolite modulare — un singolo deploy, database condiviso, ma con la logica divisa in moduli indipendenti attivabili per tenant.

## Grafico dipendenze moduli

```
1 Base          <- sempre attivo
  +-- 2 Piani   <- richiede Base
  |     +-- 3 Scadenze  <- richiede Base + Piani
  +-- 5 Tecnici <- richiede Base
  |     +-- 4 Scheduling <- richiede Base + Tecnici
  +-- 6 Mobile  <- richiede Base
  +-- * MaintAI <- richiede Base
```
"""

FILES["docs/features/modules.md"] = """\
# Moduli MaintAI Base

## Come aggiungere un nuovo modulo

1. Crea `backend/app/features/<nome>/` con `__init__.py`, `models.py`, `schemas.py`, `router.py`
2. Aggiungi i modelli a `backend/app/db/__init__.py`
3. Registra il router in `backend/app/main.py`
4. Aggiungi la dipendenza in `MODULE_DEPENDENCIES` in `feature_flags.py`
5. Aggiungi il flag in `DEFAULT_FEATURES`
6. Crea `frontend/src/features/<nome>/` con `index.ts`, `types.ts`
7. Aggiungi `ModuleName` type in `frontend/src/lib/features.tsx`

## Moduli disponibili

| Modulo | Dipende da | Tabelle principali |
|--------|-----------|-------------------|
| base | — | tenants, utenti, siti, impianti, assets, tickets |
| piani | base | piani_manutenzione, attivita_manutenzione, generated_plans |
| scadenze | base, piani | scadenze |
| tecnici | base | tecnici, tecnico_assenze |
| scheduling | base, tecnici | slot_calendario |
| mobile | base | (usa tabelle di base) |
| maintai | base | diagnostic_sessions, analisi_guasto |
"""

# ─── Backend empty __init__.py files ─────────────────────────────────────────

for pkg in [
    "backend/__init__.py",
    "backend/app/__init__.py",
    "backend/app/core/__init__.py",
    "backend/app/shared/__init__.py",
    "backend/app/features/base/__init__.py",
    "backend/app/features/piani/__init__.py",
    "backend/app/features/scadenze/__init__.py",
    "backend/app/features/tecnici/__init__.py",
    "backend/app/features/scheduling/__init__.py",
    "backend/app/features/mobile/__init__.py",
    "backend/app/features/maintai/__init__.py",
    "backend/tests/__init__.py",
]:
    FILES[pkg] = ""

FILES["backend/requirements.txt"] = """\
fastapi==0.115.5
uvicorn[standard]==0.32.1
sqlalchemy==2.0.36
alembic==1.14.0
pydantic==2.10.3
pydantic-settings==2.7.0
python-jose[cryptography]==3.3.0
bcrypt==4.2.1
python-multipart==0.0.18
httpx==0.28.1
openai==1.57.2
slowapi==0.1.9
"""

FILES["backend/Dockerfile"] = """\
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD [\"uvicorn\", \"app.main:app\", \"--host\", \"0.0.0.0\", \"--port\", \"8000\"]
"""

FILES["backend/alembic.ini"] = """\
[alembic]
script_location = alembic
prepend_sys_path = .
sqlalchemy.url = sqlite:///./maintai.db

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console
qualname =

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
"""

FILES["backend/alembic/env.py"] = """\
import sys
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import get_settings
from app.core.database import Base
import app.db  # noqa: F401

settings = get_settings()
config = context.config
config.set_main_option(\"sqlalchemy.url\", settings.DATABASE_URL)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option(\"sqlalchemy.url\")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={\"paramstyle\": \"named\"},
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix=\"sqlalchemy.\",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
"""

FILES["backend/alembic/script.py.mako"] = """\
\"\"\"${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}

\"\"\"
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
${imports if imports else \"\"}

revision: str = ${repr(up_revision)}
down_revision: Union[str, None] = ${repr(down_revision)}
branch_labels: Union[str, Sequence[str], None] = ${repr(branch_labels)}
depends_on: Union[str, Sequence[str], None] = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else \"pass\"}


def downgrade() -> None:
    ${downgrades if downgrades else \"pass\"}
"""

FILES["backend/app/core/config.py"] = """\
from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / \".env\",
        env_file_encoding=\"utf-8\",
        extra=\"ignore\",
    )

    VERSION: str = (BASE_DIR.parent / \"VERSION\").read_text().strip()
    APP_NAME: str = \"MaintAI Base\"
    DEBUG: bool = False
    SECRET_KEY: str = \"change-me\"
    ALGORITHM: str = \"HS256\"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440
    DATABASE_URL: str = \"sqlite:///./maintai.db\"
    DEMO_DATABASE_URL: str = \"sqlite:///./demo.db\"
    CORS_ORIGINS: str = \"http://localhost:3000\"
    OPENAI_API_KEY: str = \"\"
    OPENAI_MODEL: str = \"gpt-4.1-mini\"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(\",\")]


@lru_cache
def get_settings() -> Settings:
    return Settings()
"""

FILES["backend/app/core/database.py"] = """\
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import get_settings

settings = get_settings()

engine = create_engine(
    settings.DATABASE_URL,
    connect_args={\"check_same_thread\": False} if \"sqlite\" in settings.DATABASE_URL else {},
    pool_pre_ping=True,
)

demo_engine = create_engine(
    settings.DEMO_DATABASE_URL,
    connect_args={\"check_same_thread\": False},
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
DemoSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=demo_engine)


class Base(DeclarativeBase):
    pass
"""

FILES["backend/app/core/dependencies.py"] = """\
from collections.abc import Generator

from sqlalchemy.orm import Session

from app.core.database import DemoSessionLocal, SessionLocal
from app.core.security import get_current_user_payload


def get_db(
    payload: dict = __import__(\"fastapi\").Depends(get_current_user_payload),
) -> Generator[Session, None, None]:
    if payload.get(\"is_demo\"):
        db = DemoSessionLocal()
    else:
        db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_db_plain() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
"""

FILES["backend/app/core/security.py"] = """\
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from app.core.config import get_settings

settings = get_settings()
bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(data: dict[str, Any]) -> str:
    payload = data.copy()
    payload[\"exp\"] = datetime.now(timezone.utc) + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=\"Token non valido o scaduto\",
        )


def get_current_user_payload(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict[str, Any]:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=\"Token mancante\")
    return decode_token(credentials.credentials)


def get_current_tenant_id(
    payload: dict[str, Any] = Depends(get_current_user_payload),
) -> str:
    tenant_id = payload.get(\"tenant_id\")
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=\"Tenant non identificato\")
    return tenant_id


def require_superadmin(
    payload: dict[str, Any] = Depends(get_current_user_payload),
) -> dict[str, Any]:
    if payload.get(\"ruolo\") != \"superadmin\":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=\"Accesso riservato ai superadmin\")
    return payload
"""

FILES["backend/app/core/exceptions.py"] = """\
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={\"detail\": exc.message})
"""

FILES["backend/app/core/logger_db.py"] = """\
import logging
from typing import Any

from sqlalchemy.orm import Session

logger = logging.getLogger(\"maintai\")


def log_to_db(db, level, message, tenant_id=None, extra=None):
    try:
        from app.features.base.models import SystemLog
        entry = SystemLog(level=level.upper(), message=message, tenant_id=tenant_id, extra=extra or {})
        db.add(entry)
        db.commit()
    except Exception as e:
        logger.error(\"Failed to write log to DB: %s\", e)


def db_info(db, message, tenant_id=None, **kwargs):
    logger.info(message)
    log_to_db(db, \"INFO\", message, tenant_id, kwargs or None)


def db_error(db, message, tenant_id=None, **kwargs):
    logger.error(message)
    log_to_db(db, \"ERROR\", message, tenant_id, kwargs or None)


def db_warning(db, message, tenant_id=None, **kwargs):
    logger.warning(message)
    log_to_db(db, \"WARNING\", message, tenant_id, kwargs or None)
"""

FILES["backend/app/core/feature_flags.py"] = """\
from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.dependencies import get_db
from app.core.security import get_current_tenant_id

MODULE_DEPENDENCIES: dict[str, list[str]] = {
    \"base\": [],
    \"piani\": [\"base\"],
    \"scadenze\": [\"base\", \"piani\"],
    \"tecnici\": [\"base\"],
    \"scheduling\": [\"base\", \"tecnici\"],
    \"mobile\": [\"base\"],
    \"maintai\": [\"base\"],
}

DEFAULT_FEATURES: dict[str, bool] = {
    \"base\": True,
    \"piani\": False,
    \"scadenze\": False,
    \"scheduling\": False,
    \"tecnici\": False,
    \"mobile\": False,
    \"maintai\": False,
}


def get_tenant_features(tenant_id: str, db: Session) -> dict[str, bool]:
    from app.features.base.models import Tenant
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        return DEFAULT_FEATURES.copy()
    stored = tenant.features or {}
    return {**DEFAULT_FEATURES, **stored}


def is_feature_active(feature: str, tenant_id: str, db: Session) -> bool:
    return get_tenant_features(tenant_id, db).get(feature, False)


def require_feature(feature_name: str):
    async def _guard(
        tenant_id: str = Depends(get_current_tenant_id),
        db: Session = Depends(get_db),
    ) -> None:
        if not is_feature_active(feature_name, tenant_id, db):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f\"Modulo '{feature_name}' non attivato per questo tenant\",
            )
    return Depends(_guard)


def activate_feature(feature: str, tenant_id: str, db: Session) -> dict[str, bool]:
    from app.features.base.models import Tenant
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise ValueError(f\"Tenant {tenant_id} non trovato\")
    features = get_tenant_features(tenant_id, db)
    for dep in MODULE_DEPENDENCIES.get(feature, []):
        features[dep] = True
    features[feature] = True
    tenant.features = features
    db.commit()
    return features


def deactivate_feature(feature: str, tenant_id: str, db: Session) -> dict[str, bool]:
    from app.features.base.models import Tenant
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise ValueError(f\"Tenant {tenant_id} non trovato\")
    features = get_tenant_features(tenant_id, db)
    for mod, deps in MODULE_DEPENDENCIES.items():
        if feature in deps:
            features[mod] = False
    features[feature] = False
    features[\"base\"] = True
    tenant.features = features
    db.commit()
    return features
"""

FILES["backend/app/db/__init__.py"] = """\
from app.core.database import Base  # noqa: F401
from app.features.base.models import (  # noqa: F401
    Asset, Impianto, Sito, SystemLog, Tenant, Ticket, TicketAllegato, Utente,
)
from app.features.piani.models import (  # noqa: F401
    AttivitaManutenzione, GeneratedPlan, PianoManutenzione,
)
from app.features.scadenze.models import Scadenza  # noqa: F401
from app.features.tecnici.models import Tecnico, TecnicoAssenza  # noqa: F401
from app.features.scheduling.models import SlotCalendario  # noqa: F401
from app.features.maintai.models import AnalisiGuasto, DiagnosticSession  # noqa: F401

__all__ = [\"Base\"]
"""

FILES["backend/app/main.py"] = """\
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.exceptions import register_exception_handlers

settings = get_settings()
logging.basicConfig(level=logging.DEBUG if settings.DEBUG else logging.INFO)
logger = logging.getLogger(\"maintai\")


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.VERSION,
        docs_url=\"/docs\",
        redoc_url=\"/redoc\",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=[\"*\"],
        allow_headers=[\"*\"],
    )
    register_exception_handlers(app)
    _register_routers(app)

    @app.on_event(\"startup\")
    async def startup():
        _init_db()
        logger.info(\"MaintAI Base v%s started\", settings.VERSION)

    @app.get(\"/health\", tags=[\"system\"])
    def health():
        return {\"status\": \"ok\", \"version\": settings.VERSION}

    return app


def _register_routers(app: FastAPI) -> None:
    from app.features.base.router import router as base_router
    from app.features.maintai.router import router as maintai_router
    from app.features.mobile.router import router as mobile_router
    from app.features.piani.router import router as piani_router
    from app.features.scadenze.router import router as scadenze_router
    from app.features.scheduling.router import router as scheduling_router
    from app.features.tecnici.router import router as tecnici_router

    app.include_router(base_router, prefix=\"/api\")
    app.include_router(piani_router, prefix=\"/api\")
    app.include_router(scadenze_router, prefix=\"/api\")
    app.include_router(tecnici_router, prefix=\"/api\")
    app.include_router(scheduling_router, prefix=\"/api\")
    app.include_router(mobile_router, prefix=\"/api\")
    app.include_router(maintai_router, prefix=\"/api\")


def _init_db() -> None:
    from app.core.database import Base, engine
    import app.db  # noqa: F401
    Base.metadata.create_all(bind=engine)
    logger.info(\"Database tables ensured\")


app = create_app()
"""

FILES["backend/app/features/base/models.py"] = """\
import uuid
from datetime import datetime, timezone
from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

def _now(): return datetime.now(timezone.utc)
def _uuid(): return str(uuid.uuid4())

class Tenant(Base):
    __tablename__ = \"tenants\"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    nome: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    piano: Mapped[str] = mapped_column(String(50), default=\"base\")
    attivo: Mapped[bool] = mapped_column(Boolean, default=True)
    features: Mapped[dict] = mapped_column(JSON, default=lambda: {\"base\": True})
    creato_il: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

class Utente(Base):
    __tablename__ = \"utenti\"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey(\"tenants.id\"), nullable=False)
    username: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    ruolo: Mapped[str] = mapped_column(String(50), default=\"operatore\")
    attivo: Mapped[bool] = mapped_column(Boolean, default=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    creato_il: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    tenant: Mapped[\"Tenant\"] = relationship(\"Tenant\", lazy=\"select\")

class Sito(Base):
    __tablename__ = \"siti\"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey(\"tenants.id\"), nullable=False)
    nome: Mapped[str] = mapped_column(String(255), nullable=False)
    indirizzo: Mapped[str | None] = mapped_column(Text)
    attivo: Mapped[bool] = mapped_column(Boolean, default=True)
    creato_il: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    impianti: Mapped[list[\"Impianto\"]] = relationship(\"Impianto\", back_populates=\"sito\")

class Impianto(Base):
    __tablename__ = \"impianti\"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey(\"tenants.id\"), nullable=False)
    sito_id: Mapped[int] = mapped_column(Integer, ForeignKey(\"siti.id\"), nullable=False)
    nome: Mapped[str] = mapped_column(String(255), nullable=False)
    descrizione: Mapped[str | None] = mapped_column(Text)
    attivo: Mapped[bool] = mapped_column(Boolean, default=True)
    creato_il: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    sito: Mapped[\"Sito\"] = relationship(\"Sito\", back_populates=\"impianti\")
    assets: Mapped[list[\"Asset\"]] = relationship(\"Asset\", back_populates=\"impianto\")

class Asset(Base):
    __tablename__ = \"assets\"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey(\"tenants.id\"), nullable=False)
    impianto_id: Mapped[int] = mapped_column(Integer, ForeignKey(\"impianti.id\"), nullable=False)
    nome: Mapped[str] = mapped_column(String(255), nullable=False)
    codice: Mapped[str | None] = mapped_column(String(100))
    categoria: Mapped[str | None] = mapped_column(String(100))
    stato: Mapped[str] = mapped_column(String(50), default=\"Operativo\")
    note: Mapped[str | None] = mapped_column(Text)
    extra: Mapped[dict] = mapped_column(JSON, default=dict)
    creato_il: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    impianto: Mapped[\"Impianto\"] = relationship(\"Impianto\", back_populates=\"assets\")
    tickets: Mapped[list[\"Ticket\"]] = relationship(\"Ticket\", back_populates=\"asset\")

class Ticket(Base):
    __tablename__ = \"tickets\"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey(\"tenants.id\"), nullable=False)
    asset_id: Mapped[int | None] = mapped_column(Integer, ForeignKey(\"assets.id\"))
    titolo: Mapped[str] = mapped_column(String(500), nullable=False)
    descrizione: Mapped[str | None] = mapped_column(Text)
    tipo: Mapped[str] = mapped_column(String(10), default=\"CM\")
    priorita: Mapped[str] = mapped_column(String(10), default=\"Media\")
    stato: Mapped[str] = mapped_column(String(20), default=\"Aperto\")
    durata_stimata_ore: Mapped[float | None] = mapped_column(Float)
    planned_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    planned_finish: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    tecnico_id: Mapped[int | None] = mapped_column(Integer)
    creato_il: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    aggiornato_il: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    asset: Mapped[\"Asset | None\"] = relationship(\"Asset\", back_populates=\"tickets\")
    allegati: Mapped[list[\"TicketAllegato\"]] = relationship(\"TicketAllegato\", back_populates=\"ticket\")

class TicketAllegato(Base):
    __tablename__ = \"ticket_allegati\"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticket_id: Mapped[int] = mapped_column(Integer, ForeignKey(\"tickets.id\"), nullable=False)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey(\"tenants.id\"), nullable=False)
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(100))
    creato_il: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    ticket: Mapped[\"Ticket\"] = relationship(\"Ticket\", back_populates=\"allegati\")

class SystemLog(Base):
    __tablename__ = \"system_logs\"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str | None] = mapped_column(String(36))
    level: Mapped[str] = mapped_column(String(20), default=\"INFO\")
    message: Mapped[str] = mapped_column(Text, nullable=False)
    extra: Mapped[dict] = mapped_column(JSON, default=dict)
    creato_il: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
"""

FILES["backend/app/features/base/schemas.py"] = """\
from datetime import datetime
from pydantic import BaseModel, Field

class TenantOut(BaseModel):
    id: str; nome: str; email: str; piano: str; attivo: bool; features: dict[str, bool]
    model_config = {\"from_attributes\": True}

class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=200)

class TokenResponse(BaseModel):
    access_token: str; token_type: str = \"bearer\"

class TicketCreate(BaseModel):
    asset_id: int | None = None
    titolo: str = Field(min_length=1, max_length=500)
    descrizione: str | None = None
    tipo: str = Field(default=\"CM\", pattern=\"^(BD|PM|CM)$\")
    priorita: str = Field(default=\"Media\", pattern=\"^(Alta|Media|Bassa)$\")
    durata_stimata_ore: float | None = Field(default=None, ge=0.25, le=720)

class TicketUpdate(BaseModel):
    titolo: str | None = Field(default=None, min_length=1, max_length=500)
    descrizione: str | None = None
    tipo: str | None = Field(default=None, pattern=\"^(BD|PM|CM)$\")
    priorita: str | None = Field(default=None, pattern=\"^(Alta|Media|Bassa)$\")
    stato: str | None = Field(default=None, pattern=\"^(Aperto|Pianificato|In corso|Chiuso|Eliminato)$\")
    durata_stimata_ore: float | None = Field(default=None, ge=0.25, le=720)
    tecnico_id: int | None = None

class TicketOut(BaseModel):
    id: int; tenant_id: str; asset_id: int | None; titolo: str; descrizione: str | None
    tipo: str; priorita: str; stato: str; durata_stimata_ore: float | None
    planned_start: datetime | None; planned_finish: datetime | None
    tecnico_id: int | None; creato_il: datetime; aggiornato_il: datetime
    model_config = {\"from_attributes\": True}

class TicketListResponse(BaseModel):
    items: list[TicketOut]; total: int; page: int; page_size: int

class AssetCreate(BaseModel):
    impianto_id: int
    nome: str = Field(min_length=1, max_length=255)
    codice: str | None = Field(default=None, max_length=100)
    categoria: str | None = None; note: str | None = None

class AssetOut(BaseModel):
    id: int; tenant_id: str; impianto_id: int; nome: str; codice: str | None
    categoria: str | None; stato: str; creato_il: datetime
    model_config = {\"from_attributes\": True}

class SitoCreate(BaseModel):
    nome: str = Field(min_length=1, max_length=255); indirizzo: str | None = None

class SitoOut(BaseModel):
    id: int; tenant_id: str; nome: str; indirizzo: str | None; attivo: bool
    model_config = {\"from_attributes\": True}

class ImpiantoCreate(BaseModel):
    sito_id: int; nome: str = Field(min_length=1, max_length=255); descrizione: str | None = None

class ImpiantoOut(BaseModel):
    id: int; tenant_id: str; sito_id: int; nome: str; descrizione: str | None; attivo: bool
    model_config = {\"from_attributes\": True}
"""

FILES["backend/app/features/base/router.py"] = """\
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.core.dependencies import get_db
from app.core.security import get_current_tenant_id, create_access_token, verify_password
from app.core.database import SessionLocal
from app.features.base.models import Asset, Impianto, Sito, Ticket, Utente
from app.features.base.schemas import (
    AssetCreate, AssetOut, ImpiantoCreate, ImpiantoOut,
    LoginRequest, TokenResponse, SitoCreate, SitoOut,
    TicketCreate, TicketListResponse, TicketOut, TicketUpdate,
)

router = APIRouter()

@router.post(\"/auth/login\", response_model=TokenResponse, tags=[\"auth\"])
def login(body: LoginRequest):
    _db = SessionLocal()
    try:
        user = _db.query(Utente).filter(Utente.username == body.username, Utente.attivo == True).first()
        if not user or not verify_password(body.password, user.hashed_password):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=\"Credenziali non valide\")
        token = create_access_token({\"sub\": user.username, \"user_id\": user.id, \"tenant_id\": user.tenant_id, \"ruolo\": user.ruolo, \"is_demo\": user.is_demo})
        return TokenResponse(access_token=token)
    finally:
        _db.close()

@router.get(\"/tickets\", response_model=TicketListResponse, tags=[\"tickets\"])
def list_tickets(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), stato: str | None = None, tipo: str | None = None, tenant_id: str = Depends(get_current_tenant_id), db: Session = Depends(get_db)):
    q = db.query(Ticket).filter(Ticket.tenant_id == tenant_id)
    if stato: q = q.filter(Ticket.stato == stato)
    if tipo: q = q.filter(Ticket.tipo == tipo)
    total = q.count()
    items = q.order_by(Ticket.creato_il.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return TicketListResponse(items=items, total=total, page=page, page_size=page_size)

@router.post(\"/tickets\", response_model=TicketOut, status_code=status.HTTP_201_CREATED, tags=[\"tickets\"])
def create_ticket(body: TicketCreate, tenant_id: str = Depends(get_current_tenant_id), db: Session = Depends(get_db)):
    ticket = Ticket(**body.model_dump(), tenant_id=tenant_id)
    db.add(ticket); db.commit(); db.refresh(ticket); return ticket

@router.patch(\"/tickets/{ticket_id}\", response_model=TicketOut, tags=[\"tickets\"])
def update_ticket(ticket_id: int, body: TicketUpdate, tenant_id: str = Depends(get_current_tenant_id), db: Session = Depends(get_db)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == tenant_id).first()
    if not ticket: raise HTTPException(status_code=404, detail=\"Ticket non trovato\")
    for field, value in body.model_dump(exclude_unset=True).items(): setattr(ticket, field, value)
    if body.stato == \"Aperto\": ticket.planned_start = None; ticket.planned_finish = None; ticket.tecnico_id = None
    db.commit(); db.refresh(ticket); return ticket

@router.delete(\"/tickets/{ticket_id}\", status_code=status.HTTP_204_NO_CONTENT, tags=[\"tickets\"])
def delete_ticket(ticket_id: int, tenant_id: str = Depends(get_current_tenant_id), db: Session = Depends(get_db)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == tenant_id).first()
    if not ticket: raise HTTPException(status_code=404, detail=\"Ticket non trovato\")
    ticket.stato = \"Eliminato\"; db.commit()

@router.get(\"/siti\", response_model=list[SitoOut], tags=[\"siti\"])
def list_siti(tenant_id: str = Depends(get_current_tenant_id), db: Session = Depends(get_db)):
    return db.query(Sito).filter(Sito.tenant_id == tenant_id, Sito.attivo == True).all()

@router.post(\"/siti\", response_model=SitoOut, status_code=status.HTTP_201_CREATED, tags=[\"siti\"])
def create_sito(body: SitoCreate, tenant_id: str = Depends(get_current_tenant_id), db: Session = Depends(get_db)):
    sito = Sito(**body.model_dump(), tenant_id=tenant_id); db.add(sito); db.commit(); db.refresh(sito); return sito

@router.get(\"/impianti\", response_model=list[ImpiantoOut], tags=[\"impianti\"])
def list_impianti(tenant_id: str = Depends(get_current_tenant_id), db: Session = Depends(get_db)):
    return db.query(Impianto).filter(Impianto.tenant_id == tenant_id, Impianto.attivo == True).all()

@router.post(\"/impianti\", response_model=ImpiantoOut, status_code=status.HTTP_201_CREATED, tags=[\"impianti\"])
def create_impianto(body: ImpiantoCreate, tenant_id: str = Depends(get_current_tenant_id), db: Session = Depends(get_db)):
    sito = db.query(Sito).filter(Sito.id == body.sito_id, Sito.tenant_id == tenant_id).first()
    if not sito: raise HTTPException(status_code=404, detail=\"Sito non trovato\")
    impianto = Impianto(**body.model_dump(), tenant_id=tenant_id); db.add(impianto); db.commit(); db.refresh(impianto); return impianto

@router.get(\"/assets\", response_model=list[AssetOut], tags=[\"assets\"])
def list_assets(tenant_id: str = Depends(get_current_tenant_id), db: Session = Depends(get_db)):
    return db.query(Asset).filter(Asset.tenant_id == tenant_id).all()

@router.post(\"/assets\", response_model=AssetOut, status_code=status.HTTP_201_CREATED, tags=[\"assets\"])
def create_asset(body: AssetCreate, tenant_id: str = Depends(get_current_tenant_id), db: Session = Depends(get_db)):
    impianto = db.query(Impianto).filter(Impianto.id == body.impianto_id, Impianto.tenant_id == tenant_id).first()
    if not impianto: raise HTTPException(status_code=404, detail=\"Impianto non trovato\")
    asset = Asset(**body.model_dump(), tenant_id=tenant_id); db.add(asset); db.commit(); db.refresh(asset); return asset
"""

FILES["backend/app/features/piani/models.py"] = """\
from datetime import datetime, timezone
from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

def _now(): return datetime.now(timezone.utc)

class PianoManutenzione(Base):
    __tablename__ = \"piani_manutenzione\"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey(\"tenants.id\"), nullable=False)
    asset_id: Mapped[int | None] = mapped_column(Integer, ForeignKey(\"assets.id\"))
    nome: Mapped[str] = mapped_column(String(255), nullable=False)
    descrizione: Mapped[str | None] = mapped_column(Text)
    creato_il: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    attivita: Mapped[list[\"AttivitaManutenzione\"]] = relationship(\"AttivitaManutenzione\", back_populates=\"piano\")

class AttivitaManutenzione(Base):
    __tablename__ = \"attivita_manutenzione\"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey(\"tenants.id\"), nullable=False)
    piano_id: Mapped[int] = mapped_column(Integer, ForeignKey(\"piani_manutenzione.id\"), nullable=False)
    titolo: Mapped[str] = mapped_column(String(500), nullable=False)
    tipo: Mapped[str] = mapped_column(String(10), default=\"PM\")
    frequenza: Mapped[str | None] = mapped_column(String(100))
    durata_ore: Mapped[float | None] = mapped_column(Float)
    competenze: Mapped[list] = mapped_column(JSON, default=list)
    creato_il: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    piano: Mapped[\"PianoManutenzione\"] = relationship(\"PianoManutenzione\", back_populates=\"attivita\")

class GeneratedPlan(Base):
    __tablename__ = \"generated_plans\"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey(\"tenants.id\"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default=\"draft\")
    plan_number: Mapped[int | None] = mapped_column(Integer)
    plan_json: Mapped[dict] = mapped_column(JSON, default=dict)
    efficiency_score: Mapped[int | None] = mapped_column(Integer)
    confirmed_by: Mapped[str | None] = mapped_column(String(100))
    deauthorized_by: Mapped[str | None] = mapped_column(String(100))
    deauthorization_reason: Mapped[str | None] = mapped_column(Text)
    creato_il: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
"""

for mod, prefix, guard in [
    (\"piani\", \"/piani\", \"piani\"),
    (\"scadenze\", \"/scadenze\", \"scadenze\"),
    (\"tecnici\", \"/tecnici\", \"tecnici\"),
    (\"scheduling\", \"/scheduling\", \"scheduling\"),
    (\"maintai\", \"/maintai\", \"maintai\"),
    (\"mobile\", \"/mobile\", \"mobile\"),
]:
    FILES[f\"backend/app/features/{mod}/router.py\"] = f\"\"\"\
from fastapi import APIRouter, Depends\nfrom sqlalchemy.orm import Session\nfrom app.core.dependencies import get_db\nfrom app.core.feature_flags import require_feature\nfrom app.core.security import get_current_tenant_id\n\nrouter = APIRouter(prefix=\\\"{prefix}\\\", tags=[\\\"{mod}\\\"], dependencies=[require_feature(\\\"{guard}\\\")])\n\n@router.get(\\\"/status\\\")\ndef status_check(tenant_id: str = Depends(get_current_tenant_id), db: Session = Depends(get_db)):\n    return {{\"module\": \\\"{mod}\\\", \"status\": \"active\"}}\n\"\"\"

FILES["backend/app/features/scadenze/models.py"] = """\
from datetime import date, datetime, timezone
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base

def _now(): return datetime.now(timezone.utc)

class Scadenza(Base):
    __tablename__ = \"scadenze\"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey(\"tenants.id\"), nullable=False)
    piano_id: Mapped[int | None] = mapped_column(Integer, ForeignKey(\"piani_manutenzione.id\"))
    attivita_id: Mapped[int | None] = mapped_column(Integer, ForeignKey(\"attivita_manutenzione.id\"))
    asset_id: Mapped[int | None] = mapped_column(Integer, ForeignKey(\"assets.id\"))
    titolo: Mapped[str] = mapped_column(String(500), nullable=False)
    data_scadenza: Mapped[date] = mapped_column(Date, nullable=False)
    completata: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str | None] = mapped_column(Text)
    creato_il: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
"""

FILES["backend/app/features/tecnici/models.py"] = """\
from datetime import date, datetime, timezone
from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base

def _now(): return datetime.now(timezone.utc)

class Tecnico(Base):
    __tablename__ = \"tecnici\"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey(\"tenants.id\"), nullable=False)
    nome: Mapped[str] = mapped_column(String(255), nullable=False)
    cognome: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255))
    specializzazione: Mapped[str | None] = mapped_column(String(100))
    competenze: Mapped[list] = mapped_column(JSON, default=list)
    ore_giornaliere: Mapped[float] = mapped_column(default=8.0)
    attivo: Mapped[bool] = mapped_column(Boolean, default=True)
    creato_il: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

class TecnicoAssenza(Base):
    __tablename__ = \"tecnico_assenze\"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey(\"tenants.id\"), nullable=False)
    tecnico_id: Mapped[int] = mapped_column(Integer, ForeignKey(\"tecnici.id\"), nullable=False)
    data_inizio: Mapped[date] = mapped_column(Date, nullable=False)
    data_fine: Mapped[date] = mapped_column(Date, nullable=False)
    motivo: Mapped[str | None] = mapped_column(Text)
    creato_il: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
"""

FILES["backend/app/features/scheduling/models.py"] = """\
from datetime import datetime, timezone
from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base

def _now(): return datetime.now(timezone.utc)

class SlotCalendario(Base):
    __tablename__ = \"slot_calendario\"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey(\"tenants.id\"), nullable=False)
    tecnico_id: Mapped[int] = mapped_column(Integer, ForeignKey(\"tecnici.id\"), nullable=False)
    ticket_id: Mapped[int | None] = mapped_column(Integer, ForeignKey(\"tickets.id\"))
    inizio: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    fine: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    tipo: Mapped[str] = mapped_column(String(20), default=\"lavoro\")
    creato_il: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
"""

FILES["backend/app/features/maintai/models.py"] = """\
from datetime import datetime, timezone
from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base

def _now(): return datetime.now(timezone.utc)

class DiagnosticSession(Base):
    __tablename__ = \"diagnostic_sessions\"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey(\"tenants.id\"), nullable=False)
    ticket_id: Mapped[int | None] = mapped_column(Integer, ForeignKey(\"tickets.id\"))
    asset_id: Mapped[int | None] = mapped_column(Integer, ForeignKey(\"assets.id\"))
    stato: Mapped[str] = mapped_column(String(20), default=\"aperta\")
    messaggi: Mapped[list] = mapped_column(JSON, default=list)
    risultato: Mapped[str | None] = mapped_column(Text)
    creato_il: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    aggiornato_il: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

class AnalisiGuasto(Base):
    __tablename__ = \"analisi_guasto\"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey(\"tenants.id\"), nullable=False)
    ticket_id: Mapped[int | None] = mapped_column(Integer, ForeignKey(\"tickets.id\"))
    asset_id: Mapped[int | None] = mapped_column(Integer, ForeignKey(\"assets.id\"))
    sintomi: Mapped[str | None] = mapped_column(Text)
    causa_radice: Mapped[str | None] = mapped_column(Text)
    azioni_correttive: Mapped[list] = mapped_column(JSON, default=list)
    modello_usato: Mapped[str | None] = mapped_column(String(100))
    creato_il: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
"""

FILES["backend/tests/test_feature_flags.py"] = """\
def test_module_dependencies_defined():
    from app.core.feature_flags import MODULE_DEPENDENCIES
    assert \"base\" in MODULE_DEPENDENCIES
    assert \"piani\" in MODULE_DEPENDENCIES
    assert \"base\" in MODULE_DEPENDENCIES[\"piani\"]

def test_base_always_required():
    from app.core.feature_flags import MODULE_DEPENDENCIES
    for mod, deps in MODULE_DEPENDENCIES.items():
        if mod != \"base\":
            assert \"base\" in deps or any(\"base\" in MODULE_DEPENDENCIES.get(d, []) for d in deps)

def test_scheduling_requires_tecnici():
    from app.core.feature_flags import MODULE_DEPENDENCIES
    assert \"tecnici\" in MODULE_DEPENDENCIES[\"scheduling\"]

def test_scadenze_requires_piani():
    from app.core.feature_flags import MODULE_DEPENDENCIES
    assert \"piani\" in MODULE_DEPENDENCIES[\"scadenze\"]
"""

# ─── Frontend ─────────────────────────────────────────────────────────────────

FILES["frontend/package.json"] = """\
{
  \"name\": \"maintai-base-frontend\",
  \"version\": \"1.0.0\",
  \"private\": true,
  \"scripts\": {
    \"dev\": \"next dev\",
    \"build\": \"next build\",
    \"start\": \"next start\",
    \"lint\": \"next lint\",
    \"type-check\": \"tsc --noEmit\"
  },
  \"dependencies\": {
    \"next\": \"15.1.0\",
    \"react\": \"19.0.0\",
    \"react-dom\": \"19.0.0\",
    \"jose\": \"^5.9.6\",
    \"sonner\": \"^1.7.1\",
    \"clsx\": \"^2.1.1\",
    \"tailwind-merge\": \"^2.5.5\",
    \"lucide-react\": \"^0.468.0\",
    \"@radix-ui/react-dialog\": \"^1.1.4\",
    \"@radix-ui/react-dropdown-menu\": \"^2.1.4\",
    \"@radix-ui/react-select\": \"^2.1.4\",
    \"@radix-ui/react-toast\": \"^1.2.4\",
    \"recharts\": \"^2.14.1\"
  },
  \"devDependencies\": {
    \"@types/node\": \"^22\",
    \"@types/react\": \"^19\",
    \"@types/react-dom\": \"^19\",
    \"typescript\": \"^5\",
    \"tailwindcss\": \"^4\",
    \"@tailwindcss/postcss\": \"^4\",
    \"eslint\": \"^9\",
    \"eslint-config-next\": \"15.1.0\"
  }
}
"""

FILES["frontend/tsconfig.json"] = """\
{
  \"compilerOptions\": {
    \"target\": \"ES2017\",
    \"lib\": [\"dom\", \"dom.iterable\", \"esnext\"],
    \"allowJs\": true,
    \"skipLibCheck\": true,
    \"strict\": true,
    \"noEmit\": true,
    \"esModuleInterop\": true,
    \"module\": \"esnext\",
    \"moduleResolution\": \"bundler\",
    \"resolveJsonModule\": true,
    \"isolatedModules\": true,
    \"jsx\": \"preserve\",
    \"incremental\": true,
    \"plugins\": [{\"name\": \"next\"}],
    \"paths\": { \"@/*\": [\"./src/*\"] }
  },
  \"include\": [\"next-env.d.ts\", \"**/*.ts\", \"**/*.tsx\", \".next/types/**/*.ts\"],
  \"exclude\": [\"node_modules\"]
}
"""

FILES["frontend/next.config.ts"] = """\
import type { NextConfig } from \"next\";
import { readFileSync } from \"fs\";
import { join } from \"path\";

const version = readFileSync(join(__dirname, \"../VERSION\"), \"utf-8\").trim();

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_VERSION: version },
  async headers() {
    return [{
      source: \"/(.*)\",
      headers: [
        { key: \"X-Frame-Options\", value: \"DENY\" },
        { key: \"X-Content-Type-Options\", value: \"nosniff\" },
        { key: \"Referrer-Policy\", value: \"strict-origin-when-cross-origin\" },
        { key: \"X-XSS-Protection\", value: \"1; mode=block\" },
      ],
    }];
  },
};

export default nextConfig;
"""

FILES["frontend/Dockerfile"] = """\
FROM node:22-alpine AS deps\nWORKDIR /app\nCOPY package.json package-lock.json* ./\nRUN npm ci\n\nFROM node:22-alpine AS builder\nWORKDIR /app\nCOPY --from=deps /app/node_modules ./node_modules\nCOPY . .\nRUN npm run build\n\nFROM node:22-alpine AS runner\nWORKDIR /app\nENV NODE_ENV=production\nCOPY --from=builder /app/.next/standalone ./\nCOPY --from=builder /app/.next/static ./.next/static\nCOPY --from=builder /app/public ./public\nEXPOSE 3000\nCMD [\"node\", \"server.js\"]\n"""

FILES["frontend/src/app/globals.css"] = """\
@import \"tailwindcss\";

:root {
  --background: #0a0f1e;
  --card: #111827;
  --card-elevated: #1f2937;
  --border: #374151;
  --text-primary: #f9fafb;
  --text-secondary: #9ca3af;
  --accent: #3b82f6;
  --accent-hover: #2563eb;
  --success: #22c55e;
  --warning: #f59e0b;
  --danger: #ef4444;
}
[data-theme=\"dark\"] { color-scheme: dark; }
body { background: var(--background); color: var(--text-primary); font-family: system-ui, sans-serif; }
.ticket-bd { color: #ef4444; } .ticket-pm { color: #22c55e; } .ticket-cm { color: #f59e0b; }
"""

FILES["frontend/src/lib/api.ts"] = """\
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? \"http://localhost:8000\";

function getToken() {
  if (typeof window === \"undefined\") return null;
  return localStorage.getItem(\"token\");
}

async function request<T>(method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
  const token = getToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(`${API_BASE}${path}`, {
    method, signal: controller.signal,
    headers: { \"Content-Type\": \"application/json\", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  clearTimeout(timer);
  if (!res.ok) { const err = await res.json().catch(() => ({ detail: res.statusText })); throw new ApiError(res.status, err.detail ?? \"Errore sconosciuto\"); }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = \"ApiError\"; }
}

export const api = {
  get: <T>(path: string) => request<T>(\"GET\", path),
  post: <T>(path: string, body: unknown) => request<T>(\"POST\", path, body),
  patch: <T>(path: string, body: unknown) => request<T>(\"PATCH\", path, body),
  put: <T>(path: string, body: unknown) => request<T>(\"PUT\", path, body),
  delete: <T>(path: string) => request<T>(\"DELETE\", path),
};
"""

FILES["frontend/src/lib/auth.tsx"] = """\
\"use client\";
import { createContext, useContext, useEffect, useState } from \"react\";
import { api } from \"@/lib/api\";

interface AuthUser { username: string; tenant_id: string; ruolo: string; is_demo: boolean; }
interface AuthContextValue { user: AuthUser | null; token: string | null; login: (u: string, p: string) => Promise<void>; logout: () => void; isLoading: boolean; }

const AuthContext = createContext<AuthContextValue | null>(null);

function parseJwt(token: string): AuthUser | null {
  try { const p = JSON.parse(atob(token.split(\".\")[1])); return { username: p.sub, tenant_id: p.tenant_id, ruolo: p.ruolo, is_demo: p.is_demo ?? false }; }
  catch { return null; }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => { const s = localStorage.getItem(\"token\"); if (s) { setToken(s); setUser(parseJwt(s)); } setIsLoading(false); }, []);
  async function login(username: string, password: string) {
    const res = await api.post<{ access_token: string }>(\"/api/auth/login\", { username, password });
    localStorage.setItem(\"token\", res.access_token); setToken(res.access_token); setUser(parseJwt(res.access_token));
  }
  function logout() { localStorage.removeItem(\"token\"); setToken(null); setUser(null); }
  return <AuthContext.Provider value={{ user, token, login, logout, isLoading }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error(\"useAuth must be used within AuthProvider\");
  return ctx;
}
"""

FILES["frontend/src/lib/features.tsx"] = """\
\"use client\";
import { createContext, useContext, useEffect, useState } from \"react\";
import { useAuth } from \"@/lib/auth\";
import { api } from \"@/lib/api\";

export type ModuleName = \"base\" | \"piani\" | \"scadenze\" | \"scheduling\" | \"tecnici\" | \"mobile\" | \"maintai\";
type FeaturesMap = Record<ModuleName, boolean>;

const DEFAULT: FeaturesMap = { base: true, piani: false, scadenze: false, scheduling: false, tecnici: false, mobile: false, maintai: false };
const FeaturesContext = createContext<FeaturesMap>(DEFAULT);

export function FeaturesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [features, setFeatures] = useState<FeaturesMap>(DEFAULT);
  useEffect(() => {
    if (!user) { setFeatures(DEFAULT); return; }
    api.get<FeaturesMap>(\"/api/me/features\").then(setFeatures).catch(() => setFeatures(DEFAULT));
  }, [user?.tenant_id]);
  return <FeaturesContext.Provider value={features}>{children}</FeaturesContext.Provider>;
}

export function useFeatures(): FeaturesMap { return useContext(FeaturesContext); }
export function useFeature(module: ModuleName): boolean { return useFeatures()[module]; }
"""

FILES["frontend/src/lib/utils.ts"] = """\
import { clsx, type ClassValue } from \"clsx\";
import { twMerge } from \"tailwind-merge\";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
"""

FILES["frontend/src/app/layout.tsx"] = """\
import type { Metadata } from \"next\";
import { Inter } from \"next/font/google\";
import { Toaster } from \"sonner\";
import { AuthProvider } from \"@/lib/auth\";
import { FeaturesProvider } from \"@/lib/features\";
import \"./globals.css\";

const inter = Inter({ subsets: [\"latin\"] });
export const metadata: Metadata = { title: \"MaintAI\", description: \"Industrial maintenance management\" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang=\"it\" data-theme=\"dark\">
      <body className={inter.className}>
        <AuthProvider><FeaturesProvider>{children}<Toaster position=\"top-right\" richColors /></FeaturesProvider></AuthProvider>
      </body>
    </html>
  );
}
"""

FILES["frontend/src/app/page.tsx"] = """\
\"use client\";
import { useEffect } from \"react\";
import { useRouter } from \"next/navigation\";
import { useAuth } from \"@/lib/auth\";
export default function HomePage() {
  const { user, isLoading } = useAuth(); const router = useRouter();
  useEffect(() => { if (!isLoading) router.replace(user ? \"/dashboard\" : \"/login\"); }, [user, isLoading, router]);
  return null;
}
"""

FILES["frontend/src/app/login/page.tsx"] = """\
\"use client\";
import { useState } from \"react\";
import { useRouter } from \"next/navigation\";
import { useAuth } from \"@/lib/auth\";
import { toast } from \"sonner\";
export default function LoginPage() {
  const { login } = useAuth(); const router = useRouter();
  const [username, setUsername] = useState(\"\"); const [password, setPassword] = useState(\"\"); const [loading, setLoading] = useState(false);
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true);
    try { await login(username, password); router.push(\"/dashboard\"); }
    catch { toast.error(\"Credenziali non valide\"); } finally { setLoading(false); }
  }
  return (
    <div className=\"min-h-screen flex items-center justify-center\" style={{ background: \"var(--background)\" }}>
      <div className=\"w-full max-w-sm p-8 rounded-xl\" style={{ background: \"var(--card)\", border: \"1px solid var(--border)\" }}>
        <h1 className=\"text-2xl font-bold mb-2\">MaintAI</h1>
        <form onSubmit={handleSubmit} className=\"space-y-4\">
          <input type=\"text\" value={username} onChange={e => setUsername(e.target.value)} required placeholder=\"Username\" className=\"w-full px-3 py-2 rounded-lg text-sm\" style={{ background: \"var(--card-elevated)\", border: \"1px solid var(--border)\", color: \"var(--text-primary)\" }} />
          <input type=\"password\" value={password} onChange={e => setPassword(e.target.value)} required placeholder=\"Password\" className=\"w-full px-3 py-2 rounded-lg text-sm\" style={{ background: \"var(--card-elevated)\", border: \"1px solid var(--border)\", color: \"var(--text-primary)\" }} />
          <button type=\"submit\" disabled={loading} className=\"w-full py-2 rounded-lg text-sm font-medium disabled:opacity-50\" style={{ background: \"var(--accent)\", color: \"white\" }}>{loading ? \"Accesso...\" : \"Accedi\"}</button>
        </form>
      </div>
    </div>
  );
}
"""

FILES["frontend/src/app/dashboard/page.tsx"] = """\
\"use client\";
import { useAuth } from \"@/lib/auth\";
import { useFeatures } from \"@/lib/features\";
export default function DashboardPage() {
  const { user } = useAuth(); const features = useFeatures();
  const activeModules = Object.entries(features).filter(([, v]) => v).map(([k]) => k);
  return (
    <div className=\"p-6\">
      <h1 className=\"text-2xl font-bold mb-1\">Dashboard</h1>
      <p style={{ color: \"var(--text-secondary)\" }}>Benvenuto, {user?.username}</p>
      <div className=\"grid grid-cols-2 md:grid-cols-3 gap-4 mt-6\">
        {activeModules.map(mod => (
          <div key={mod} className=\"p-4 rounded-xl\" style={{ background: \"var(--card)\", border: \"1px solid var(--border)\" }}>
            <p className=\"text-xs uppercase mb-1\" style={{ color: \"var(--text-secondary)\" }}>Modulo attivo</p>
            <p className=\"font-semibold capitalize\">{mod}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
"""

for mod in ["base", "piani", "scadenze", "tecnici", "scheduling", "mobile", "maintai"]:
    FILES[f"frontend/src/features/{mod}/index.ts"] = f"// {mod} feature exports\n"


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Bootstrap MAINTAI_BASE project")
    parser.add_argument("--output", default="./MAINTAI_BASE", help="Output directory")
    args = parser.parse_args()

    root = Path(args.output).resolve()

    if root.exists() and any(root.iterdir()):
        print(f"ERROR: {root} already exists and is not empty.")
        sys.exit(1)

    print(f"Creating MAINTAI_BASE at: {root}")

    for rel_path, content in FILES.items():
        target = root / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")

    print(f"  Written {len(FILES)} files")

    print("Initializing git...")
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "checkout", "-b", "main"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "add", "."], cwd=root, check=True, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "feat: initial MaintAI Base — modular monolith with feature flags"],
        cwd=root, check=True, capture_output=True,
    )

    print()
    print("Done! Now push to GitHub:")
    print()
    print(f"  cd {root}")
    print("  git remote add origin https://github.com/alexMaster9982/MAINTAI_BASE.git")
    print("  git push -u origin main")


if __name__ == "__main__":
    main()
