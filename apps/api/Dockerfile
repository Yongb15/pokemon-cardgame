# Built from the repository root: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared packages/shared
COPY apps/api/package.json apps/api/
RUN npm ci --workspace apps/api --include-workspace-root --ignore-scripts
COPY apps/api apps/api
RUN npm run build --workspace apps/api

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared packages/shared
COPY apps/api/package.json apps/api/
RUN npm ci --workspace apps/api --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /repo/apps/api/dist apps/api/dist
# The shared rules as compiled JavaScript (the API's build step compiles them)
COPY --from=build /repo/packages/shared/dist packages/shared/dist
WORKDIR /repo/apps/api
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
