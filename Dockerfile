FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
COPY src/server/package*.json ./src/server/
COPY src/shared/package*.json ./src/shared/
RUN npm install

COPY . .

CMD ["npm", "run", "server:start"]
