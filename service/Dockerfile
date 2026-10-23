# ACC reporting service image. Build context is this directory (service/). PREPARED, NOT BUILT, NOT DEPLOYED.
# Node is pinned to the version the test suite runs on (node:sqlite is experimental in Node 22).
FROM node:22.22.2-bookworm-slim
WORKDIR /app
COPY acc_core.js acc_register.js index.html ./
COPY server ./server
COPY deploy/entrypoint.sh /entrypoint.sh
RUN useradd --system --uid 10001 --no-create-home acc && mkdir -p /data && chown acc:acc /data && chmod 755 /entrypoint.sh
# The entrypoint starts as root only to fix volume ownership, then drops to the unprivileged user "acc" (runuser).
# The host terminates TLS and forwards to the INGEST port only. The private port (dashboard, reads, audit) is bound inside the
# container for administration through the host's shell and is never published.
ENV ACC_DATA_DIR=/data ACC_HOST=0.0.0.0 ACC_ALLOW_NON_LOCAL=1 ACC_PORT=8787 ACC_INGEST_PORT=8788 ACC_TRUST_PROXY=private ACC_PUBLIC_STATUS=1 NODE_NO_WARNINGS=1
# ACC_PUBLIC_ORIGIN (one https origin, for CORS on /public/status.json) is set on the host, not baked into the image.
EXPOSE 8788
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8788/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/entrypoint.sh"]
