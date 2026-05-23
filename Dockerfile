FROM node:22-bookworm

ARG USERNAME=node

ENV BUN_INSTALL=/home/${USERNAME}/.bun
ENV PATH=/home/${USERNAME}/.bun/bin:${PATH}

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    curl \
    git \
    jq \
    less \
    openssh-client \
    pkg-config \
    python3 \
    ripgrep \
    unzip \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

USER ${USERNAME}
RUN curl -fsSL https://bun.sh/install | bash

USER root
RUN mkdir -p /home/${USERNAME}/.pi \
  && chown -R ${USERNAME}:${USERNAME} /home/${USERNAME}/.pi

RUN npm install -g @earendil-works/pi-coding-agent @os-eco/mulch-cli@0.10.1 @os-eco/seeds-cli@0.4.7

USER ${USERNAME}
WORKDIR /workspaces/pi-lattice
