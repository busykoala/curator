import type { NextConfig } from "next";
const securityHeaders=[{key:"Content-Security-Policy",value:"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"},{key:"Referrer-Policy",value:"no-referrer"},{key:"X-Content-Type-Options",value:"nosniff"},{key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=()"}];
const config: NextConfig = { output: "standalone", serverExternalPackages: ["better-sqlite3", "argon2", "sharp", "taglib-wasm"], async headers(){return[{source:"/:path*",headers:securityHeaders}]} };
export default config;
