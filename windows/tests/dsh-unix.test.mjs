import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtempSync, chmodSync, lstatSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSteerServer } from "../dsh-plugin/index.js";

const unix = process.platform !== "win32";

test("Unix DSH steering uses private sockets, carries cancel/preset, and restarts", { skip: !unix }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-"));
  chmodSync(dir, 0o700);
  const endpoint = join(dir, "dsh.sock");
  const lines = [];
  const listener = startSteerServer(endpoint, (line) => lines.push(JSON.parse(line)));
  try {
    assert.equal(await listener.ready, true);
    assert.equal(lstatSync(endpoint).mode & 0o777, 0o600);
    await new Promise((resolve, reject) => {
      const client = net.connect(endpoint, () => client.end('{"kind":"cancel"}\n{"kind":"preset","preset":"ask"}\n'));
      client.on("error", reject);
      client.on("close", resolve);
    });
    assert.deepEqual(lines, [{ kind: "cancel" }, { kind: "preset", preset: "ask" }]);
    // A second plugin must never unlink the first, live server.
    const duplicate = startSteerServer(endpoint, () => assert.fail("duplicate should not listen"));
    assert.equal(await duplicate.ready, false);
    duplicate.close();
    await listener.close();
    const restarted = startSteerServer(endpoint, () => {});
    assert.equal(await restarted.ready, true);
    await restarted.close();
  } finally {
    await listener.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Unix DSH steering refuses public directories and preserves non-socket files", { skip: !unix }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-"));
  const endpoint = join(dir, "dsh.sock");
  try {
    chmodSync(dir, 0o755);
    const publicListener = startSteerServer(endpoint, () => {});
    assert.equal(await publicListener.ready, false);
    publicListener.close();
    chmodSync(dir, 0o700);
    writeFileSync(endpoint, "not a socket");
    const existing = startSteerServer(endpoint, () => {});
    assert.equal(await existing.ready, false);
    existing.close();
    assert.equal(lstatSync(endpoint).isFile(), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
