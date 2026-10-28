import test from "node:test";
import assert from "node:assert/strict";
import { get } from "node:http";
import { listenHttpServer } from "../src/utils/listenHttpServer.js";

test("HTTP startup waits for a bound port and rejects a duplicate without crashing the running server", async () => {
  const server = await listenHttpServer((_req, res) => res.end("ready"), { port: 0, host: "127.0.0.1" });
  try {
    const port = server.address().port;
    assert.ok(port > 0);
    await assert.rejects(listenHttpServer((_req, res) => res.end("duplicate"), { port, host: "127.0.0.1" }), { code: "EADDRINUSE" });
    const body = await new Promise((resolve, reject) => {
      get(`http://127.0.0.1:${port}`, response => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", chunk => { text += chunk; });
        response.on("end", () => resolve(text));
        response.on("error", reject);
      }).on("error", reject);
    });
    assert.equal(body, "ready", "the original listener still serves requests");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
