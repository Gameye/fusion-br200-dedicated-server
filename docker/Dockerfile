FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates libstdc++6 libgcc-s1 libatomic1 zlib1g \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd --gid 10001 game \
    && useradd --uid 10001 --gid game --home-dir /data --no-create-home --shell /usr/sbin/nologin game \
    && mkdir /data && chown game:game /data

ARG GIT_SHA=unknown
ARG SERVER_BINARY_SHA=unknown
LABEL org.opencontainers.image.revision=$GIT_SHA \
      org.gameye.server-binary.sha256=$SERVER_BINARY_SHA

WORKDIR /server
COPY Builds/linux-server/ /server/
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /server/BR200.x86_64

USER 10001:10001
EXPOSE 7777/udp
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
