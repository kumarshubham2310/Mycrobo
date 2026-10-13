module.exports = {
  apps: [
    {
      name: "mycrobo-gateway",
      script: "services/gateway/server.mjs",
      node_args: "--experimental-strip-types",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        MYCROBO_GATEWAY_PORT: 4177,
        MYCROBO_GATEWAY_HOST: "127.0.0.1",
      },
    },
  ],
};
