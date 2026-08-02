// Optional PM2 setup: pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: "fb-worker",
      script: "src/index.mjs",
      cwd: __dirname,
      interpreter: "node",
      autorestart: true,
      restart_delay: 10000,
      max_restarts: 0,
      max_memory_restart: "1500M",
      out_file: "./logs/pm2-out.log",
      error_file: "./logs/pm2-error.log",
      time: true,
      env: { NODE_ENV: "production" },
    },
  ],
};
