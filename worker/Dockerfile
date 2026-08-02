FROM mcr.microsoft.com/playwright:v1.49.0-jammy

ENV NODE_ENV=production \
    PROFILE_DIR=/data/fb-profile \
    LOG_DIR=/data/logs \
    PORT=8787 \
    BIND=0.0.0.0

# Tools for the one-time interactive Facebook login over noVNC.
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb x11vnc novnc websockify x11-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

RUN mkdir -p /data/fb-profile /data/logs
VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=60s --timeout=10s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.mjs"]
