.PHONY: help setup install sync build-data dev receiver build typecheck lint test preview vercel-link deploy-preview deploy-prod clean

PNPM_BIN ?= $(shell command -v pnpm)
PNPM_NODE_BIN := $(dir $(PNPM_BIN))node
PNPM_NODE_DIR := $(dir $(PNPM_NODE_BIN))
PNPM := $(if $(wildcard $(PNPM_NODE_BIN)),$(PNPM_NODE_BIN) $(PNPM_BIN),pnpm)
PNPM_ENV := PATH="$(PNPM_NODE_DIR):$$PATH"

RECEIVER_HOST ?= 0.0.0.0
RECEIVER_PORT ?= 8788
RECEIVER_OUTPUT_ROOT ?= vault/apple-health
RECEIVER_STATE_ROOT ?= vault/apple-health-sync-server

help:
	@echo "Available targets:"
	@echo ""
	@echo "Setup:"
	@echo "  install         - Install frontend dependencies with pnpm"
	@echo "  sync            - Sync the local uv environment"
	@echo "  setup           - Initialize submodules, install pnpm deps, and sync uv"
	@echo ""
	@echo "App:"
	@echo "  build-data      - Generate src/generated/workouts.json from data/training"
	@echo "  dev             - Run the Vite dev server"
	@echo "  receiver        - Run the Apple Health sync receiver"
	@echo "  build           - Build the app for production"
	@echo "  preview         - Run the Vite preview server"
	@echo ""
	@echo "Checks:"
	@echo "  typecheck       - Run TypeScript checks"
	@echo "  lint            - Run ESLint"
	@echo "  test            - Run Vitest"
	@echo ""
	@echo "Deploy:"
	@echo "  vercel-link     - Link this repo to a Vercel project"
	@echo "  deploy-preview  - Build locally and upload a prebuilt preview deployment"
	@echo "  deploy-prod     - Build locally and upload a prebuilt production deployment"
	@echo ""
	@echo "Cleaning:"
	@echo "  clean           - Remove generated workout data and route files"

install:
	$(PNPM_ENV) $(PNPM) install

sync:
	uv sync

setup:
	git submodule update --init --recursive
	$(PNPM_ENV) $(PNPM) install
	uv sync

build-data:
	$(PNPM_ENV) $(PNPM) run build:data

dev:
	$(PNPM_ENV) $(PNPM) run dev

receiver:
	$(PNPM_ENV) $(PNPM) run serve:apple-health-sync -- --host $(RECEIVER_HOST) --port $(RECEIVER_PORT) --output-root $(RECEIVER_OUTPUT_ROOT) --state-root $(RECEIVER_STATE_ROOT)

build:
	$(PNPM_ENV) $(PNPM) run build

typecheck:
	$(PNPM_ENV) $(PNPM) run typecheck

lint:
	$(PNPM_ENV) $(PNPM) run lint

test:
	$(PNPM_ENV) $(PNPM) run test

preview:
	$(PNPM_ENV) $(PNPM) run preview

vercel-link:
	$(PNPM_ENV) $(PNPM) run vercel:link

deploy-preview:
	$(PNPM_ENV) $(PNPM) run deploy:vercel:preview

deploy-prod:
	$(PNPM_ENV) $(PNPM) run deploy:vercel:prod

clean:
	rm -f src/generated/workouts.json
	rm -rf public/generated/workout-routes
