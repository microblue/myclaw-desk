const path = require("node:path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained .next/standalone/ tree with only the modules
  // the server traces (NFT). Cuts shipped studio size from ~445 MB to
  // ~100 MB and the file count from ~10k to ~3k — translates directly to
  // faster NSIS extraction on Windows (Defender scans every file written).
  // build-studio.mjs flattens .next/standalone/ into dist-studio/ after
  // the build.
  output: "standalone",

  // Without this, Next walks up the filesystem looking for the nearest
  // pnpm/lockfile and uses that as the trace root. In our build, that
  // resolves to the desktop monorepo root, which makes standalone emit
  // .next/standalone/home/runner/work/myclaw-desk/myclaw-desk/dist-studio/
  // server.js — i.e., the full workspace path replicated under standalone.
  // Pinning the trace root to the studio dir keeps standalone flat.
  outputFileTracingRoot: __dirname,

  serverExternalPackages: ["ws", "better-sqlite3"],
};

module.exports = nextConfig;
