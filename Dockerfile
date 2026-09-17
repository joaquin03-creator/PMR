# PMR production image — runs the same Express server (server.ts) that
# npm run dev/start use locally, in production mode, on Cloud Run.
FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 8080

CMD ["npm", "start"]
