FROM node:22-alpine

WORKDIR /usr/src/app

# copy package.json / package-lock.json
COPY package*.json ./

# install deps
RUN npm ci --omit=dev || npm install --omit=dev

# copy rest of app
COPY . .

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]
