# Build only the explicit output of scripts/package-container.mjs.
FROM node:20.20.1-bookworm@sha256:abc255963bb4311b1f81bf45f2382df39a4041d2a975b1807d05809f1bc21bbe
LABEL org.opencontainers.image.title="ATLAS private workspace service" \
      atlas.release.status="worktree-candidate"
ENV NODE_ENV=production ATLAS_PRIVATE_LISTEN_HOST=0.0.0.0 PORT=8091
COPY --chown=0:0 app/ /app/
RUN test "$(dpkg-query -W -f='${Version}' libc6)" = '2.36-9+deb12u13' \
 && test "$(dpkg-query -W -f='${Version}' libssl3)" = '3.0.18-1~deb12u2' \
 && chmod 0555 /app
WORKDIR /app
USER 65532:65532
RUN --network=none /app/container/entrypoint.sh --smoke
ENTRYPOINT ["/app/container/entrypoint.sh"]
