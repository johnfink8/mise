FROM mcr.microsoft.com/playwright:v1.55.0-jammy
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY playwright.config.ts ./
COPY happy-path.spec.ts ./
ENV CI=1
CMD ["npx", "playwright", "test"]
