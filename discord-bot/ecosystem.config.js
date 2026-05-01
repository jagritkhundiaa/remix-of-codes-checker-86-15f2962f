// PM2 config — outermost safety net.
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 save && pm2 startup     (to survive AWS reboots)
module.exports = {
  apps: [{
    name: "autizmens-bot",
    script: "src/supervisor.js",
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "1G",
    restart_delay: 1000,
    exp_backoff_restart_delay: 100,
    kill_timeout: 5000,
    env: { NODE_ENV: "production" },
  }],
};
