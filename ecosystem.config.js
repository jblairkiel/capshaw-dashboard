module.exports = {
  apps: [
    {
      name: 'capshaw-dashboard',
      script: 'server/index.js',
      cwd: '/var/www/capshaw-dashboard',
      instances: 1,
      autorestart: true,
      watch: false,
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
  ],
};
