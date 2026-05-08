/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained .next/standalone/ tree with only the modules
  // the server traces (NFT). Cuts shipped studio size from ~445 MB to
  // ~100 MB and the file count from ~10k to ~3k — translates directly to
  // faster NSIS extraction on Windows (Defender scans every file written).
  // build-studio.mjs flattens .next/standalone/ into dist-studio/ after
  // the build.
  output: "standalone",
  serverExternalPackages: ["ws", "better-sqlite3"],
};

module.exports = nextConfig;
