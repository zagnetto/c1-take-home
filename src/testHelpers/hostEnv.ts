/** Host-side integration tests reach published compose ports, not in-network hostnames. */
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.MYSQL_URL ??= 'mysql://root:root@127.0.0.1:3306/relay?charset=utf8mb4';
process.env.MONGO_URL ??= 'mongodb://127.0.0.1:27017/relay';
