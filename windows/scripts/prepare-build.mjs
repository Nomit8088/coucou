// Build the relay for the host CPU. Inherited stdio also works in confined
// Windows environments; never capture a child's output through named pipes.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateMacIcon } from "./gen-mac-icon.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform === "darwin") generateMacIcon();
const result = spawnSync("cargo", ["build", "--release", "--locked", "-p", "coucou-hook"], {
  cwd: root, stdio: "inherit",
});
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status ?? 1);
