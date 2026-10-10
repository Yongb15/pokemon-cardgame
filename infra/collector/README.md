# Price collector on Cloud Run (docs/price/collect-all.md)

Project `pokemon-card-dex-511008`. Set up by hand with gcloud on 2026-10-10; recorded here.

| Piece | Name | Notes |
|---|---|---|
| Image repo | AR `collector` (asia-southeast3) | immutable tags, cleanup: keep 5, delete after 30 days. Not the `api` repo (its deploy accounts can write there) |
| Job | `price-collector` (asia-southeast3) | image by **digest**, 1 vCPU / 512 MiB, 1 task, retries 0, timeout 110 min |
| Secret | `collector-db-url` (asia-southeast1) | production `collector_rw` URL, attached as version **:1** (`PRICE_DATABASE_URL`) |
| Run account | `collector-run` | `secretAccessor` on `collector-db-url` only |
| Schedule | Scheduler `price-collector-daily` (asia-southeast1) | `30 19 * * *` UTC → `POST …/locations/asia-southeast3/jobs/price-collector:run`, OAuth as `collector-scheduler` |
| Caller account | `collector-scheduler` | `run.invoker` on this Job only (not `jobsExecutorWithOverrides`: overrides could change env/args) |

## Build and deploy a new image

```bash
TAG=$(git rev-parse --short HEAD)
STAGE=$(mktemp -d) && infra/collector/stage.sh "$STAGE"        # only the tracked files the image needs
(cd "$STAGE" && gcloud meta list-files-for-upload . | grep -ciE '(^|/)\.env' )   # must print 0
(cd "$STAGE" && gcloud builds submit . --config=infra/collector/cloudbuild.yaml --substitutions=_TAG=$TAG --region asia-southeast3)
DIGEST=$(gcloud artifacts docker images describe asia-southeast3-docker.pkg.dev/pokemon-card-dex-511008/collector/price-collector:$TAG --format='value(image_summary.digest)')
gcloud run jobs update price-collector --region asia-southeast3 --image asia-southeast3-docker.pkg.dev/pokemon-card-dex-511008/collector/price-collector@$DIGEST
```

Run now: `gcloud run jobs execute price-collector --region asia-southeast3 --async`.
Logs: `gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="price-collector"' --limit 20`.

## Turn it off
`gcloud scheduler jobs pause price-collector-daily --location asia-southeast1` → (if leaked) reset `collector_rw`'s
password with `scripts/db-create-role.mjs` and add a new secret version, or `NOLOGIN`.

## Rotate the DB password
`scripts/db-create-role.mjs collector_rw <tmpfile>` (owner URL from neonctl) → `gcloud secrets versions add collector-db-url --data-file=-` from the file
→ `gcloud run jobs update price-collector --update-secrets PRICE_DATABASE_URL=collector-db-url:<new>` → destroy the old version → delete the file.
