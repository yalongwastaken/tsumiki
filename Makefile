# Tsumiki — task runner for the two-package repo (client + server).
# Requires Node >= 22.12 and npm. Run `make` or `make help` for the list.

.DEFAULT_GOAL := help
.PHONY: help install dev server client build start test test-client test-server test-smoke format lint clean distclean backup

## help: list the available targets
help:
	@echo "Tsumiki — make targets:"
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## /  /'

## install: install dependencies (root tooling + client + server)
install:
	npm install
	cd server && npm install
	cd client && npm install

## dev: run backend (:4000) and frontend (:5173) together, hot-reloading
dev:
	@echo "Starting server (:4000) + client (:5173) — Ctrl-C to stop both"
	@trap 'kill 0' INT TERM; \
	( cd server && npm run dev ) & \
	( cd client && npm run dev ) & \
	wait

## server: run only the backend API (dev, hot-reload) on :4000
server:
	cd server && npm run dev

## client: run only the frontend (Vite dev server) on :5173
client:
	cd client && npm run dev

## build: build the client into client/dist (served by the backend in prod)
build:
	cd client && npm run build

## start: production mode — build the client, then serve everything from :4000
start: build
	cd server && npm start

## test: run all unit tests (client + server)
test: test-server test-client

## test-server: run the engine / db / migrate unit tests
test-server:
	cd server && npm test

## test-client: run the selectors / streak / milestones unit tests
test-client:
	cd client && npm test

## test-smoke: headless render walk-through of the whole UI
test-smoke:
	cd client && npm run test:smoke

## format: auto-format the whole repo with Prettier
format:
	npm run format

## lint: lint the whole repo with ESLint (use `npm run lint:fix` to auto-fix)
lint:
	npm run lint

## backup: copy the SQLite database into ./backups (timestamped)
backup:
	@mkdir -p backups
	cp server/data/tsumiki.db backups/tsumiki-$$(date +%F).db
	@echo "backed up → backups/tsumiki-$$(date +%F).db"

## clean: remove build output and temp files (keeps node_modules + data)
clean:
	rm -rf client/dist client/test/.tmp
	rm -f client/vite.config.js.timestamp-*.mjs

## distclean: clean + remove all installed dependencies
distclean: clean
	rm -rf client/node_modules server/node_modules
