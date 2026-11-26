# The Exam Brain image. Build context is vidhya/ (the brain imports ../shared):
#   docker build -f brain/Dockerfile -t vidhya-brain vidhya/
# Runs `node dist/brain/src/server.js`. It never migrates: run
#   node dist/brain/src/cli/vidhya.js migrate $VIDHYA_DB $VIDHYA_BACKUP_DIR
# as its own step first (E13). Settings are in brain/README.md.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY brain/package.json brain/package-lock.json brain/
COPY shared shared
RUN cd brain && npm ci
COPY brain brain
RUN cd brain && npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app/brain
COPY --from=build /app/brain/node_modules node_modules
COPY --from=build /app/brain/dist dist
COPY --from=build /app/brain/package.json package.json
USER node
EXPOSE 8080
CMD ["node", "dist/brain/src/server.js"]
