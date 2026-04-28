.DEFAULT_GOAL := help
SHELL := /bin/bash

COMPOSE     := docker compose
COMPOSE_DEV := docker compose -f docker-compose.yml -f docker-compose.dev.yml
BACKEND     := backend
FRONTEND    := frontend

.PHONY: build

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ---------- bootstrap ----------

bootstrap: env frontend-deps db-up migrate backend-dev ## Full local setup, then start the backend
	@echo "✔ bootstrap complete — visit http://localhost:8080"

env: ## Create .env from .env.example if missing
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "✔ created .env — fill in PLEX_TOKEN, ANTHROPIC_API_KEY"; \
	else \
		echo "→ .env already exists"; \
	fi

backend-deps: ## Install Python deps via uv (needed for local lint/test/typecheck)
	cd $(BACKEND) && uv sync

frontend-deps: ## Install Node deps via npm
	cd $(FRONTEND) && npm install

# ---------- production containers ----------

build: ## Build the app container image (full multi-stage: SPA + backend)
	$(COMPOSE) build app

up: ## Start the full production stack (postgres + app with built SPA) in the background
	$(COMPOSE) up -d --build

down: ## Stop and remove containers (keeps the pgdata volume)
	$(COMPOSE) down

restart: down up ## Stop and start the full production stack

rebuild: ## Force-rebuild the production app image and restart
	$(COMPOSE) up -d --build --force-recreate app

logs: ## Tail logs from all services
	$(COMPOSE_DEV) logs -f

ps: ## Show container status
	$(COMPOSE_DEV) ps

# ---------- dev ----------

dev: db-up backend-dev ## Start postgres + backend dev container

backend-dev: ## Start the backend dev container (source-mounted, uvicorn --reload)
	$(COMPOSE_DEV) up -d --build app
	@echo "→ backend running at http://localhost:8080 (tailing logs — Ctrl-C to detach)"
	$(COMPOSE_DEV) logs -f app

db-up: ## Start only postgres in the background
	$(COMPOSE) up -d postgres

db-down: ## Stop postgres
	$(COMPOSE) stop postgres

migrate: ## Run Alembic migrations (starts postgres if needed)
	$(COMPOSE_DEV) run --rm app uv run alembic upgrade head

# ---------- quality gates ----------

test: test-backend test-frontend ## Run all tests

test-backend: backend-deps
	cd $(BACKEND) && uv run pytest

test-frontend: frontend-deps
	cd $(FRONTEND) && npm test -- --run

lint: backend-deps frontend-deps ## Lint backend (ruff) and frontend (eslint)
	cd $(BACKEND) && uv run ruff check app tests
	cd $(FRONTEND) && npm run lint

typecheck: backend-deps frontend-deps ## Type-check backend (mypy) and frontend (tsc)
	cd $(BACKEND) && uv run mypy app
	cd $(FRONTEND) && npm run typecheck

# ---------- cleanup ----------

clean: ## Remove containers + volumes (DESTRUCTIVE: drops local DB)
	$(COMPOSE_DEV) down -v
