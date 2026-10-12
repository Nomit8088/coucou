import type { UpdateInfo } from "./bridge";
import { HOST_OS, platformCapabilities, type HostOs } from "./platform";

export const RELEASES_URL = "https://github.com/Nomit8088/coucou/releases";

/** A UI action, not a promise of silent installation on an unsupported OS. */
export function updateAction(info: UpdateInfo, os: HostOs = HOST_OS): {
  kind: "install" | "download" | "release";
  url: string;
} {
  if (info.downloadUrl && platformCapabilities(os).directUpdateInstall) {
    return { kind: "install", url: info.downloadUrl };
  }
  // Defend even against a stale Windows response on a Mac webview.
  if (os === "macos" && info.downloadUrl) {
    try {
      if (new URL(info.downloadUrl).pathname.toLowerCase().endsWith(".dmg")) {
        return { kind: "download", url: info.downloadUrl };
      }
    } catch {}
  }
  return { kind: "release", url: info.releaseUrl || RELEASES_URL };
}
