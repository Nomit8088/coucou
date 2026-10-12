import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");

test("direct Cargo builds and Tauri CLI agree on transparent Mac private APIs", () => {
  const cargo = read("../src-tauri/Cargo.toml");
  const common = cargo.split("[dependencies]")[1].split("[target.")[0];
  assert.match(common, /tauri\s*=\s*\{[^\n]*"macos-private-api"/);
  assert.equal(JSON.parse(read("../src-tauri/tauri.conf.json")).app.macOSPrivateApi, true);
  assert.equal(JSON.parse(read("../src-tauri/tauri.macos.conf.json")).app.macOSPrivateApi, true);
});

test("Mac packaging overrides Windows resources and accepts Finder drops", () => {
  const mac = JSON.parse(read("../src-tauri/tauri.macos.conf.json"));
  assert.equal(mac.identifier, "fr.louisraille.NotchBuddy");
  assert.deepEqual(mac.bundle.targets, ["app", "dmg"]);
  assert.equal(mac.bundle.resources["../target/release/coucou-hook.exe"], null);
  assert.equal(mac.bundle.resources["../target/release/coucou-hook"], "coucou-hook");
  const island = mac.app.windows.find((w) => w.label === "island");
  assert.equal(island.dragDropEnabled, true);
  assert.equal(island.focusable, false);
  assert.equal(island.visibleOnAllWorkspaces, true);
  assert.equal(island.additionalBrowserArgs, undefined);
  assert.equal(mac.bundle.macOS.minimumSystemVersion, "13.0");
});

test("Mac placements use logical geometry and folding explicitly releases native focus", () => {
  const geometry = read("../src-tauri/src/island.rs");
  const position = geometry.slice(geometry.indexOf("pub fn apply_geometry"), geometry.indexOf("fn current_screen_key"));
  assert.match(position, /win\.set_size\(tauri::LogicalSize::new\(lw, lh\)\)/);
  assert.match(position, /win\.set_position\(tauri::LogicalPosition::new\(x as f64 \/ scale, y as f64 \/ scale\)\)/);
  const native = read("../src-tauri/src/platform/macos.rs");
  const focus = native.slice(native.indexOf("pub fn set_activating"), native.indexOf("pub fn pin_to_monitor"));
  assert.match(focus, /isKeyWindow/);
  assert.match(focus, /resignKeyWindow/);
  assert.match(focus, /deactivate/);
});

test("generated Mac ICNS has bounded PNG chunks and a Retina icon", () => {
  const bytes = readFileSync(new URL("../src-tauri/icons/icon.icns", import.meta.url));
  assert.equal(bytes.toString("ascii", 0, 4), "icns");
  assert.equal(bytes.readUInt32BE(4), bytes.length);
  let offset = 8;
  const tags = [];
  while (offset < bytes.length) {
    const tag = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32BE(offset + 4);
    assert.ok(size > 16 && offset + size <= bytes.length);
    assert.equal(bytes.toString("hex", offset + 8, offset + 16), "89504e470d0a1a0a");
    tags.push(tag);
    offset += size;
  }
  assert.equal(offset, bytes.length);
  assert.ok(tags.includes("ic08"), "256 px Retina representation required");
});
