/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["ws", "better-sqlite3"],
};

module.exports = nextConfig;
