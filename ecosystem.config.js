module.exports = {
    apps: [{
        name: 'frontend-app',
        script: 'server.js',
        cwd: '/var/www/app',
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: '256M',
        env: {
            NODE_ENV: 'production',
            PORT: 3000
        }
    }]
};
