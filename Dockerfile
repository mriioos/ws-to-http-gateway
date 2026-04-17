# ---- Build stage ----
FROM node:25-alpine AS builder

WORKDIR /app

# install deps
COPY package*.json ./
RUN npm install

# copy source
COPY tsconfig.json ./
COPY src ./src

# build TS → JS
RUN npm run build

# ---- Runtime stage ----
FROM node:25-alpine

WORKDIR /app

# install only production deps
COPY package*.json ./
RUN npm install --omit=dev

# copy compiled output
COPY --from=builder /app/dist ./dist

# Expose the gateway port specified in .env (default 8080)
EXPOSE ${GATEWAY_PORT:-8080}

# run server
CMD ["npm", "run", "start"]