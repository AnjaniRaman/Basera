# One image serves the API and the web app.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --ignore-scripts
COPY shared shared
COPY backend backend
COPY frontend frontend
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4000 DATA_DIR=/data/pglite
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/shared shared
COPY --from=build /app/backend backend
COPY --from=build /app/frontend/dist frontend/dist
VOLUME /data
EXPOSE 4000
USER node
CMD ["node", "backend/src/server.js"]
