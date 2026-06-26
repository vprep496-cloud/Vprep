/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep the dev server's generated chunks separate from production builds.
  // Running `next build` while `next dev` is open can otherwise overwrite
  // `.next/static`, leaving the dev HTML pointing at missing assets like
  // `/_next/static/chunks/main-app.js`.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
};

module.exports = nextConfig;
