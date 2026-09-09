FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94
LABEL io.codeai.profile="codeai-docker-v1"
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl python3 make g++ procps \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global --ignore-scripts @anthropic-ai/claude-code@2.1.226 @openai/codex@0.152.0 \
    && node /usr/local/lib/node_modules/@anthropic-ai/claude-code/install.cjs \
    && npm cache clean --force \
    && mkdir -p /home/agent /workspace /context /opt/codeai \
    && chmod 1777 /home/agent
COPY gateway.mjs worker.mjs /opt/codeai/
ENV DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
USER 1000:1000
WORKDIR /workspace
CMD ["sleep", "infinity"]
