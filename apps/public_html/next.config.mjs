/** @type {import('next').NextConfig} */
const config = {
  turbopack: { root: process.cwd() },
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};
export default config;
