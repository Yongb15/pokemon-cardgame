# The daily price collector (Cloud Run Job `price-collector`, docs/price/collect-all.md).
# Built from the repository root with its own ignore file (infra/collector/Dockerfile.dockerignore):
#   gcloud builds submit . --config=infra/collector/cloudbuild.yaml --substitutions=_TAG=<sha>
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY infra/collector/package.json infra/collector/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund && npm cache clean --force
# Only what the run needs: the script, the price code, the schema, three data files
COPY scripts/collect-prices.ts scripts/
COPY server/prices server/prices
COPY server/db server/db
COPY data/index.json data/tcgdex-map.json data/sets.json data/
USER node
CMD ["node_modules/.bin/tsx", "scripts/collect-prices.ts"]
