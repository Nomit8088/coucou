import type { UpdateInfo } from "./bridge";
import { HOST_OS, platformCapabilities, type HostOs } from "./platform";

/** The public repository, used only when the backend did not name one. */
export const DEFAULT_REPO = "Nomit8088/coucou";

/** Release page of the repository this build updates from. */
export function releasesUrl(repo: string = DEFAULT_REPO): string {
  return `https://github.com/${repo}/releases`;
}

export const RELEASES_URL = releasesUrl();

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
  return { kind: "release", url: info.releaseUrl || releasesUrl(info.repo) };
}
