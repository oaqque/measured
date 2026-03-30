.PHONY: help setup install sync build-data dev build typecheck lint test preview clean

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
	@echo "  build           - Build the app for production"
	@echo "  preview         - Run the Vite preview server"
	@echo ""
	@echo "Checks:"
	@echo "  typecheck       - Run TypeScript checks"
	@echo "  lint            - Run ESLint"
	@echo "  test            - Run Vitest"
	@echo ""
	@echo "Cleaning:"
	@echo "  clean           - Remove generated workout data"

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

clean:
	rm -f src/generated/workouts.json
