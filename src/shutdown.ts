import type { Server } from 'node:http';

export type ShutdownDeps = {
  server: Server;
  closeWebSockets: () => Promise<void>;
  releaseWebSockets?: () => void;
  closeMysql: () => Promise<void>;
  closeMongo: () => Promise<void>;
  closeRedis: () => Promise<void>;
  timeoutMs: number;
  exit: (code: number) => void;
};

export function createGracefulShutdown(deps: ShutdownDeps) {
  let shuttingDown = false;

  async function run(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    const { server, closeWebSockets, releaseWebSockets, closeMysql, closeMongo, closeRedis, timeoutMs } =
      deps;

    // WS shares the HTTP server — close clients first or server.close() never drains.
    await closeWebSockets();

    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          server.closeAllConnections();
          reject(new Error(`shutdown timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        server.close((err) => {
          clearTimeout(timer);
          if (err) reject(err);
          else resolve();
        });
      });

      releaseWebSockets?.();
    }

    await closeMysql();
    await closeMongo();
    await closeRedis();
  }

  return { run, isShuttingDown: () => shuttingDown };
}

let installed = false;

export function installGracefulShutdown(deps: ShutdownDeps): void {
  if (installed) return;
  installed = true;

  const shutdown = createGracefulShutdown(deps);

  const onSignal = (signal: NodeJS.Signals): void => {
    if (shutdown.isShuttingDown()) return;

    console.log(`received ${signal}, shutting down gracefully`);
    shutdown
      .run()
      .then(() => deps.exit(0))
      .catch((err) => {
        console.error('graceful shutdown failed', err);
        deps.exit(1);
      });
  };

  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
}

export function shutdownTimeoutMs(): number {
  return Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10_000;
}
