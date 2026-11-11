.PHONY: demo build test e2e

build:
	bash scripts/build.sh

demo:
	bash scripts/dev-sandbox.sh

test: build
	cd contracts && cargo test --workspace -- --test-threads=3
	pnpm -C packages/proof test
	pnpm -C services/evidence test
	pnpm -C services/indexer test
	pnpm -C services/relayer test
	pnpm -C apps/web test

e2e:
	cd apps/web && SOULPRINT_CONFIG=$(CURDIR)/config/networks.json npx playwright test
