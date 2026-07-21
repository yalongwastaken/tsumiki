# Tsumiki — task runner for the two-package repo (client + server).
# Requires Node >= 22.12 and npm. Run `make` or `make help` for the list.

.DEFAULT_GOAL := help
.PHONY: help install prices-setup dev server client build start test test-client test-server test-components test-smoke format lint clean distclean backup backup-enc

## help: list the available targets
help:
	@echo "Tsumiki — make targets:"
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## /  /'

## install: install dependencies (root tooling + client + server)
install:
	npm install
	cd server && npm install
	cd client && npm install

## prices-setup: set up the uv venv for stock-price sync (needs uv; installs yfinance)
# Price sync is ON by default; this installs the Python dep it needs to actually fetch.
# Creates ./.venv, then run with the sidecar interpreter:
#   TSUMIKI_PYTHON="$(pwd)/.venv/bin/python" make start
prices-setup:
	@command -v uv >/dev/null || { echo "uv not found — install it from https://docs.astral.sh/uv/"; exit 1; }
	uv venv
	uv pip install -r server/scripts/requirements.txt
	@echo "price sync ready — start the server with:"
	@echo "  TSUMIKI_PYTHON=\"$$(pwd)/.venv/bin/python\" make start"

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

## test: run all unit tests (client + server + components)
test: test-server test-client test-components

## test-server: run the engine / db / migrate unit tests
test-server:
	cd server && npm test

## test-client: run the selectors / streak / milestones unit tests
test-client:
	cd client && npm test

## test-components: render-level tests for key components
test-components:
	cd client && npm run test:components

## test-smoke: headless render walk-through of the whole UI
test-smoke:
	cd client && npm run test:smoke

## format: auto-format the whole repo with Prettier
format:
	npm run format

## lint: lint the whole repo with ESLint (use `npm run lint:fix` to auto-fix)
lint:
	npm run lint

## backup: WAL-safe SQLite backup into ./backups (timestamped, PLAINTEXT)
# uses `VACUUM INTO` (via node:sqlite — dependency-free) instead of `cp`: a plain copy
# of a live WAL-mode DB can miss recent writes still sitting in the -wal file
backup:
	@mkdir -p backups
	node --experimental-sqlite server/scripts/backup-db.mjs server/data/tsumiki.db backups/tsumiki-$$(date +%F).db
	@echo "backed up → backups/tsumiki-$$(date +%F).db"
	@echo "note: this copy is unencrypted — use 'make backup-enc' for an encrypted one"

## backup-enc: encrypted WAL-safe DB backup (set TSUMIKI_BACKUP_PASSPHRASE; requires gpg)
backup-enc:
	@command -v gpg >/dev/null || { echo "gpg not found — install gnupg (or use 'make backup' for a plaintext copy)"; exit 1; }
	@[ -n "$$TSUMIKI_BACKUP_PASSPHRASE" ] || { echo "set TSUMIKI_BACKUP_PASSPHRASE=... to encrypt the backup"; exit 1; }
	@mkdir -p backups
	@node --experimental-sqlite server/scripts/backup-db.mjs server/data/tsumiki.db backups/.tsumiki-enc-tmp.db
	@gpg --batch --yes --pinentry-mode loopback --passphrase "$$TSUMIKI_BACKUP_PASSPHRASE" \
		--cipher-algo AES256 -c -o backups/tsumiki-$$(date +%F).db.gpg backups/.tsumiki-enc-tmp.db
	@rm -f backups/.tsumiki-enc-tmp.db
	@echo "encrypted backup → backups/tsumiki-$$(date +%F).db.gpg"
	@echo "restore: gpg -d -o restored.db backups/tsumiki-YYYY-MM-DD.db.gpg"

## clean: remove build output and temp files (keeps node_modules + data)
clean:
	rm -rf client/dist client/test/.tmp
	rm -f client/vite.config.js.timestamp-*.mjs

## distclean: clean + remove all installed dependencies
distclean: clean
	rm -rf client/node_modules server/node_modules
