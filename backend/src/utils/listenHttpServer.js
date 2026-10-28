import { createServer } from "node:http";

// Bind before starting workers. Listen errors are asynchronous, so a surrounding
// try/catch alone cannot handle an occupied port.
export async function listenHttpServer(handler, { port, host } = {}) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };
    const onError = error => { cleanup(); reject(error); };
    const onListening = () => { cleanup(); resolve(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ port, ...(host ? { host } : {}) });
  });
  return server;
}
