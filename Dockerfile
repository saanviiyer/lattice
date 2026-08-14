# syntax=docker/dockerfile:1

# ---- Stage 1: build the client (vite build -> /app/client/dist) ----
FROM node:20-alpine AS build
WORKDIR /app
# Root postinstall runs `npm --prefix client install`, so copy both manifests.
COPY package.json package-lock.json* ./
COPY client/package.json client/package-lock.json* ./client/
RUN npm install
COPY . .
RUN npm run build

# ---- Stage 2: production runtime (serves API + static client) ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json* ./
# Runtime deps only. --ignore-scripts skips the client postinstall: the runtime
# needs the built client/dist (copied below), not the client's dev toolchain.
RUN npm install --omit=dev --ignore-scripts
COPY server ./server
COPY --from=build /app/client/dist ./client/dist

# With no ANTHROPIC_API_KEY set, the app runs in MOCK MODE (fully demoable).
# Provide ANTHROPIC_API_KEY at runtime to use the real Anthropic API.
ENV PORT=3001
EXPOSE 3001
CMD ["node", "server/index.js"]
