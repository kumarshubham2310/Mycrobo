module.exports = {
  apps: [
    {
      name: "mycrobo-gateway",
      cwd: __dirname,
      script: "services/gateway/server.mjs",
      node_args: "--experimental-strip-types",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        MYCROBO_GATEWAY_PORT: 4177,
      },
    },
  ],
};
