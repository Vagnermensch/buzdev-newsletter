# Single-image deploy: serves the static site + /api/send
FROM node:20-alpine
WORKDIR /app

# install only production deps (from the root package.json)
COPY package.json ./
RUN npm install --omit=dev

# app source (index.html, app.css, app.js, templates/, server/)
COPY . .

# platforms inject PORT; the server reads process.env.PORT (defaults to 3000)
ENV PORT=3000
EXPOSE 3000

# container healthcheck hits the endpoint's health route
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://localhost:${PORT}/api/health || exit 1

CMD ["npm", "start"]
