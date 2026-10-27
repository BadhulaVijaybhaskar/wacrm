# Tiny Connect adapter stub for staging (no Connect source vendored).
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8090 \
    HOST=0.0.0.0
RUN addgroup -S stub && adduser -S stub -G stub
COPY --chown=stub:stub server.js ./
USER stub
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8090)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
