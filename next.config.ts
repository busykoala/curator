import type { NextConfig } from "next";
const config: NextConfig = { output: "standalone", serverExternalPackages: ["better-sqlite3", "argon2", "sharp", "taglib-wasm"] };
export default config;
