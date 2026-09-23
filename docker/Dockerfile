FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94
LABEL io.codeai.profile="codeai-docker-v1"
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl python3 make g++ procps \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /home/agent /workspace /context /opt/codeai \
    && chmod 1777 /home/agent
# CodeAI names both versions on every build: DOCKER_VERSIONS when provisioning, the recorded ones
# when updating. There are no defaults, so a build without them fails instead of installing
# whatever npm calls latest. Claude comes last because it changes most often.
ARG CODEX_VERSION
RUN test -n "$CODEX_VERSION" \
    && npm install --global --ignore-scripts "@openai/codex@$CODEX_VERSION" \
    && npm cache clean --force
ARG CLAUDE_VERSION
RUN test -n "$CLAUDE_VERSION" \
    && npm install --global --ignore-scripts "@anthropic-ai/claude-code@$CLAUDE_VERSION" \
    && node /usr/local/lib/node_modules/@anthropic-ai/claude-code/install.cjs \
    && npm cache clean --force
COPY gateway.mjs worker.mjs /opt/codeai/
ENV DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
USER 1000:1000
WORKDIR /workspace
CMD ["sleep", "infinity"]
