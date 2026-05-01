// PM2 config — outermost safety net.
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 save && pm2 startup     (Linux)
//   pm2-startup install         (Windows, after `npm i -g pm2-windows-startup`)
module.exports = {
  apps: [{
    name: "autizmens-bot",
    script: "src/supervisor.js",
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    watch: false,
    // Was 1G — caused 0xC0000409 kills on 2k–4k input runs.
    // Bumped to 4G; supervisor.js + Node heap flag handle the rest.
    max_memory_restart: "4G",
    node_args: "--max-old-space-size=4096",
    restart_delay: 1000,
    exp_backoff_restart_delay: 100,
    kill_timeout: 5000,
    env: {
      NODE_ENV: "production",
      // Mirror the heap flag for any child processes the supervisor forks.
      NODE_OPTIONS: "--max-old-space-size=4096",
    },
  }],
};
