FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY public ./public
ENV NODE_ENV=production PORT=3737 DATA_DIR=/data
EXPOSE 3737
CMD ["node", "server/index.js"]
