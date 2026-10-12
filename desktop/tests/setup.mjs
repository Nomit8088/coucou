// Loaded before every test file (see the `test` script in package.json).
// Node runs the island's TypeScript as it is; this only supplies what the
// webview and the bundler normally would.

import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { internals } from "./tauri.mjs";

// The sources import each other without an extension, which Vite resolves.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const ours = !context.parentURL?.includes("/node_modules/");
    if (ours && specifier.startsWith(".") && !/\.(?:[cm]?[jt]s|json)$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
  // Vite imports JSON (src/i18n/*.json) without `with { type: "json" }`;
  // Node would refuse it, so it is handed over as a module.
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".json") && !url.includes("/node_modules/")) {
      const source = readFileSync(fileURLToPath(url), "utf8");
      return { format: "module", source: `export default ${source};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

// The island reaches timers and Tauri through `window`.
globalThis.window = globalThis;
globalThis.__TAURI_INTERNALS__ = internals;

// Since Node 21 a global `navigator` exists, and it describes the *host*: its
// platform is "Win32" on Windows but "MacIntel" on a macOS runner, and its
// language is the developer's locale. The sources read it as the webview's
// (src/core/platform.ts takes the host OS from it), so without pinning it the
// suite answers differently per machine. On a macOS runner the Windows-oriented
// tests here — shortcuts.test.mjs's Ctrl accelerators and "Win+" display names,
// spotify.test.mjs's SMTC music path — silently ran under Mac semantics instead
// and 13 assertions failed, while the same commit passed on Windows. Pin the
// baseline host, and the locale with it, so the suite only depends on its own
// inputs.
// macos.test.mjs redefines this itself, before importing the sources, to pin a
// Mac WKWebView; the property stays configurable for it. Do not import the
// sources from here: the stub must be seen only when a module is first loaded.
Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  platform: "Win32",
  language: "en-US",
  languages: ["en-US"],
} });
