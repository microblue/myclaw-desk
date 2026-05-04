# MyClaw.One Desktop

Desktop client for [myclaw.one](https://myclaw.one) — connects to local or cloud OpenClaw deployments and embeds a chat UI on top.

## Project Setup

### Install

```bash
pnpm install              # root: Electron app
cd studio && npm install  # sub-project: embedded Studio (one-time)
```

### Development

```bash
pnpm dev
```

Boots the splash, spawns the embedded Studio child, swaps the window URL once Studio is ready.

### Build

```bash
pnpm build:mac    # or :win / :linux
```
