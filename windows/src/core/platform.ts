// Frontend capabilities for the Tauri app, not the separate Swift app.
export type HostOs = "windows" | "linux" | "macos";

/** WKWebView reports Macintosh; do not treat every non-Windows host as Linux. */
export function detectHostOs(userAgent: string, platform = ""): HostOs {
  if (/Windows|Win32|Win64/i.test(`${userAgent} ${platform}`)) return "windows";
  if (/Macintosh|MacIntel|MacPPC|Mac OS X|macOS/i.test(`${userAgent} ${platform}`)) return "macos";
  return "linux";
}

export let HOST_OS: HostOs = typeof navigator === "undefined"
  ? "linux"
  : detectHostOs(navigator.userAgent ?? "", navigator.platform ?? "");

/** The native boot is authoritative; UA detection is only for browser previews. */
export function setNativeHost(os: unknown): void {
  if (os === "windows" || os === "linux" || os === "macos") HOST_OS = os;
}

export function platformCapabilities(os: HostOs = HOST_OS) {
  return {
    // The Tauri backend has SMTC / MPRIS, but no macOS now-playing adapter.
    music: os !== "macos",
    musicLikeHotkeys: os === "windows",
    globalShortcuts: true,
    desktopMochi: os !== "macos",
    directUpdateInstall: os === "windows",
    primaryModifier: os === "macos" ? "Command" : "Ctrl",
  } as const;
}
