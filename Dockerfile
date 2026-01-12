# backend/Dockerfile
FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production

COPY sterkbouw-saas-back/package.json ./
RUN npm install --omit=dev

COPY sterkbouw-saas-back/ ./

EXPOSE 10000

CMD ["node", "ao.js"]
