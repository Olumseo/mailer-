/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep native/CJS/Node-builtin-using packages runtime-external so Next doesn't
  // try to bundle them into the (server-action) graph.
  serverExternalPackages: ["xlsx", "@electric-sql/pglite", "nodemailer", "imapflow"],
};

export default nextConfig;
