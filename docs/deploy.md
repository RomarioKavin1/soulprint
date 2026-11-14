# Deploy (testnet)

## Web — Vercel
- Project `manmade` (scope romario-kavins-projects), root directory `apps/web`, Node 22.
- Live: https://manmade.works (domain manmade.works not attached yet).
- Every push to `main` deploys (Vercel git integration). Manual: `vercel deploy --prod --scope romario-kavins-projects` from the repo root.
- Env (production + preview): `SOULPRINT_NETWORK=testnet`, `SOULPRINT_CONFIG_JSON` (the `testnet` entry of config/networks.json — no secrets), `EVIDENCE_URL=<tunnel>/ev`, `INDEXER_URL=<tunnel>/ix`, `GALLERY_TEST_ARTISTS=soulprint-v1-artist.soulprint-owner-12f173.testnet` (marks the deploy's test pieces: the gallery's **Hide test pieces** option, ticked by default, hides them; the landing and artist pages leave them out; their pages still open by link).

## Services — OCI_ARM_1 (ssh alias in ~/.ssh/config)
- Everything under `~/manmade`: `app/` (this repo, pulled with a read-only deploy key in `keys/`), `data/{evidence,indexer,relayer}`, `env/services.env` (secret keys, chmod 600, never in git).
- `env/services.env` also sets `NOTES_OPERATORS=soulprint-owner-12f173.testnet` (who may remove reported reader questions; without it nobody can).
- `deploy/oci/compose.yml`: evidence, indexer, relayer, a Caddy proxy (`/ev`, `/ix`; relayer private) and a cloudflared quick tunnel.
- Auto-deploy: `.github/workflows/deploy-services.yml` on pushes to `main` touching services/packages/deploy. It SSHes with a key the host restricts to `deploy/oci/deploy.sh` (line tagged `manmade-actions` in `~/.ssh/authorized_keys`). Secrets: `OCI_SSH_KEY`, `OCI_HOST`, `OCI_KNOWN_HOSTS`.
- Manual: `ssh OCI_ARM_1 ~/manmade/app/deploy/oci/deploy.sh`.

## The quick tunnel URL
It stays while the tunnel container lives (deploys never recreate it). After a host reboot or a tunnel restart it changes:
1. `ssh OCI_ARM_1 ~/manmade/app/deploy/oci/tunnel-url.sh`
2. Update `EVIDENCE_URL` (`…/ev`) and `INDEXER_URL` (`…/ix`) on Vercel (production and preview), then redeploy.
A named Cloudflare tunnel on manmade.works (one `cloudflared tunnel login` on the host) would make the URL permanent.

## Remove everything
- Host: `cd ~/manmade/app/deploy/oci && docker compose -p manmade down --rmi local`, then `rm -rf ~/manmade` and delete the `manmade-actions` line from `~/.ssh/authorized_keys`.
- GitHub: delete the deploy key "manmade-oci" and the three `OCI_*` secrets.
- Vercel: delete the `manmade` project.
