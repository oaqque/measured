.PHONY: help setup install sync build-data dev receiver build typecheck lint test preview vercel-link deploy-preview deploy-prod clean

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
	pnpm install

sync:
	uv sync

setup:
	git submodule update --init --recursive
	pnpm install
	uv sync

build-data:
	pnpm run build:data

dev:
	pnpm run dev

receiver:
	pnpm run serve:apple-health-sync -- --host $(RECEIVER_HOST) --port $(RECEIVER_PORT) --output-root $(RECEIVER_OUTPUT_ROOT) --state-root $(RECEIVER_STATE_ROOT)

build:
	pnpm run build

typecheck:
	pnpm run typecheck

lint:
	pnpm run lint

test:
	pnpm run test

preview:
	pnpm run preview

vercel-link:
	pnpm run vercel:link

deploy-preview:
	pnpm run deploy:vercel:preview

deploy-prod:
	pnpm run deploy:vercel:prod

clean:
	rm -f src/generated/workouts.json
	rm -rf public/generated/workout-routes
