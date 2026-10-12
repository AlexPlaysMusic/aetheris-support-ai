// PM2 process file — keeps the Aetheris production server alive.
// Commands (run in this folder):
//   pm2 start ecosystem.config.js   start / restart the site
//   pm2 list                        status
//   pm2 logs aetheris               live logs
//   pm2 stop aetheris               stop the site
//   pm2 save                        remember processes after reboot setup
module.exports = {
  apps: [
    {
      name: 'aetheris',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
