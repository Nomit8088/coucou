// GitHub release updates: launch the installer on Windows, manual download on
// macOS. Unsupported targets must never fetch or write a Windows executable.

use serde::{Deserialize, Serialize};
use serde_json::Value;
#[cfg(any(windows, target_os = "macos"))]
use std::process::Command;
use tauri::Emitter;

use crate::secrets;

/// `owner/repo` this build reads releases from. `build.rs` sets it from the
/// checkout's `origin` (or `COUCOU_UPDATE_REPO`), so a private mirror updates
/// from itself while a plain build keeps reading the public repository.
const GITHUB_REPO: &str = match option_env!("COUCOU_UPDATE_REPO") {
    Some(repo) => repo,
    None => "Nomit8088/coucou",
};
/// The repository a plain build reads, and the one an anonymous request can
/// still read: everything else is a private fork whose releases need a token.
const PUBLIC_REPO: &str = "Nomit8088/coucou";
const USER_AGENT: &str = "Coucou-App";
/// Read-only token for a private fork, kept in the OS credential store by
/// `secrets.rs` — never in the binary, which anyone with the installer can read.
const TOKEN_KEY: &str = "update-token";

/// A private repository answers 404 to an anonymous release request, so this
/// build cannot even ask without a credential.
fn private_channel() -> bool {
    GITHUB_REPO != PUBLIC_REPO
}

fn update_token() -> Option<String> {
    if private_channel() {
        secrets::get(TOKEN_KEY)
    } else {
        None
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_notes: String,
    pub release_url: String,
    pub download_url: Option<String>,
    /// Same asset, reached through the authenticated API endpoint. Only a
    /// private build fills it in: github.com's download path answers 404 to a
    /// token, while api.github.com redirects to a signed asset URL.
    pub download_api_url: Option<String>,
    pub file_name: Option<String>,
    /// The repository this build updates from, so the UI never hardcodes one.
    pub repo: String,
}

/// What the settings window needs before it offers a check: which repository
/// this build reads, and whether it is a private one that needs a token.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateChannel {
    pub repo: String,
    pub private: bool,
    pub has_token: bool,
}

#[tauri::command]
pub fn update_channel() -> UpdateChannel {
    UpdateChannel {
        repo: GITHUB_REPO.to_string(),
        private: private_channel(),
        has_token: update_token().is_some(),
    }
}

fn parse_semver(v: &str) -> Option<(u64, u64, u64)> {
    let clean = v.trim_start_matches(|c: char| !c.is_ascii_digit());
    let parts: Vec<&str> = clean.split('.').collect();
    if parts.len() < 2 {
        return None;
    }
    let major = parts.first()?.parse().ok()?;
    let minor = parts.get(1)?.parse().ok()?;
    let patch = parts
        .get(2)
        .and_then(|s| s.split(|c: char| !c.is_ascii_digit()).next())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    Some((major, minor, patch))
}

fn is_newer(current: &str, latest: &str) -> bool {
    match (parse_semver(current), parse_semver(latest)) {
        (Some(c), Some(l)) => l > c,
        _ => false,
    }
}

/** Only HTTPS links belonging to this repository's release pages/assets. */
fn release_link(url: &str, asset: bool) -> bool {
    let Ok(url) = reqwest::Url::parse(url) else {
        return false;
    };
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return false;
    }
    let prefix = format!("/{GITHUB_REPO}/releases/");
    let Some(rest) = url.path().strip_prefix(&prefix) else {
        return false;
    };
    if asset {
        let parts: Vec<_> = rest.split('/').collect();
        parts.len() == 3 && parts[0] == "download" && !parts[1].is_empty() && !parts[2].is_empty()
    } else {
        rest == "latest"
            || rest
                .strip_prefix("tag/")
                .is_some_and(|tag| !tag.is_empty() && !tag.contains('/'))
    }
}

/** The API endpoint of one asset of this repository's `latest` release. Only
 * this exact shape is accepted, so a tampered response cannot point the token
 * or the download at another repository. */
fn api_asset_link(url: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(url) else {
        return false;
    };
    if url.scheme() != "https"
        || url.host_str() != Some("api.github.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return false;
    }
    let prefix = format!("/repos/{GITHUB_REPO}/releases/assets/");
    url.path()
        .strip_prefix(&prefix)
        .is_some_and(|id| !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()))
}

/** Where GitHub's signed asset redirect may land. Only the Windows download
 * walks the redirect by hand; elsewhere this is test-only. */
#[cfg_attr(not(windows), allow(dead_code))]
fn asset_redirect(url: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(url) else {
        return false;
    };
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some_and(|host| {
            host == "githubusercontent.com" || host.ends_with(".githubusercontent.com")
        })
}

/** Prefer a matching architecture DMG, then an explicitly universal DMG.
 * An unlabelled DMG is ambiguous; do not guess that it supports this Mac. */
fn asset_rank(name: &str, os: &str, arch: &str) -> Option<u8> {
    let name = name.to_ascii_lowercase();
    match os {
        "windows" if name.ends_with("-setup.exe") => Some(0),
        "windows" if name.ends_with(".exe") => Some(1),
        "macos" if name.ends_with(".dmg") => {
            let arm = name.contains("aarch64") || name.contains("arm64");
            let intel = name.contains("x86_64") || name.contains("x64") || name.contains("amd64");
            let universal = name.contains("universal");
            if universal {
                return Some(1);
            }
            match arch {
                "aarch64" if arm && !intel => Some(0),
                "x86_64" if intel && !arm => Some(0),
                _ => None,
            }
        }
        _ => None,
    }
}

/// The installer a release offers for this machine.
struct Asset {
    /// `https://github.com/.../releases/download/...` — what a browser opens.
    browser_url: String,
    /// `https://api.github.com/.../releases/assets/{id}` — how a token fetches.
    api_url: Option<String>,
    name: String,
}

fn select_asset(json: &Value, os: &str, arch: &str) -> Option<Asset> {
    json.get("assets")?
        .as_array()?
        .iter()
        .filter_map(|asset| {
            let name = asset.get("name")?.as_str()?;
            let url = asset.get("browser_download_url")?.as_str()?;
            let rank = asset_rank(name, os, arch)?;
            if !release_link(url, true) {
                return None;
            }
            let path = reqwest::Url::parse(url).ok()?.path().to_ascii_lowercase();
            if (os == "windows" && !path.ends_with(".exe"))
                || (os == "macos" && !path.ends_with(".dmg"))
            {
                return None;
            }
            let api_url = asset
                .get("url")
                .and_then(Value::as_str)
                .filter(|url| api_asset_link(url))
                .map(str::to_string);
            Some((
                rank,
                Asset {
                    browser_url: url.to_string(),
                    api_url,
                    name: name.to_string(),
                },
            ))
        })
        .min_by_key(|(rank, _)| *rank)
        .map(|(_, asset)| asset)
}

#[tauri::command]
pub async fn check_for_update(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("https://api.github.com/repos/{GITHUB_REPO}/releases/latest");
    // A private fork's releases are invisible to an anonymous request (404); the
    // token is optional here so that a build of a public fork still works, and
    // so the settings window can tell "needs a token" from "nothing published".
    let token = update_token();
    let mut request = client.get(&url).header("Accept", "application/vnd.github+json");
    if let Some(token) = &token {
        request = request.header("Authorization", format!("Bearer {token}"));
    }
    let resp = request
        .send()
        .await
        .map_err(|e| format!("Network request failed: {e}"))?;
    if !resp.status().is_success() {
        let reason = match resp.status().as_u16() {
            401 | 403 => "the token is invalid or has no read access to this repository",
            404 => "no release is visible — wrong repository, or the token cannot see it",
            _ => "see the status above",
        };
        return Err(format!(
            "GitHub API returned status: {} ({reason})",
            resp.status()
        ));
    }
    let json: Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {e}"))?;

    let tag_name = json.get("tag_name").and_then(Value::as_str).unwrap_or("");
    let latest_version = tag_name
        .trim_start_matches(|c: char| !c.is_ascii_digit())
        .to_string();
    let release_notes = json
        .get("body")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let release_url = json
        .get("html_url")
        .and_then(Value::as_str)
        .filter(|url| release_link(url, false))
        .map(str::to_string)
        .unwrap_or_else(|| format!("https://github.com/{GITHUB_REPO}/releases/latest"));
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let has_update = is_newer(&current_version, &latest_version);
    let asset = select_asset(&json, std::env::consts::OS, std::env::consts::ARCH);
    let (download_url, download_api_url, file_name) = asset
        .map(|asset| (Some(asset.browser_url), asset.api_url, Some(asset.name)))
        .unwrap_or_default();

    let info = UpdateInfo {
        has_update,
        current_version,
        latest_version,
        release_notes,
        release_url,
        download_url,
        download_api_url,
        file_name,
        repo: GITHUB_REPO.to_string(),
    };
    // The island keeps the blue Mochi honest: a check made from the settings
    // window tells it what came back, whether or not a new version is out.
    let _ = app.emit("update-found", info.clone());
    Ok(info)
}

/// GitHub answers an authenticated asset request with a 302 to a signed URL on
/// its asset host. That signed URL is public, but reqwest drops the Authorization
/// header when a redirect changes host — so the two steps are done by hand.
#[cfg(windows)]
async fn fetch_with_token(api_url: &str, token: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(180))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(api_url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/octet-stream")
        .send()
        .await
        .map_err(|e| format!("Download request failed: {e}"))?;
    if !resp.status().is_redirection() {
        return Err(format!("Download failed with status: {}", resp.status()));
    }
    let location = resp
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|value| value.to_str().ok())
        .ok_or("Download redirect had no location")?
        .to_string();
    if !asset_redirect(&location) {
        return Err("Download redirected outside GitHub's asset host".into());
    }
    let plain = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = plain
        .get(&location)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Download failed with status: {}", resp.status()));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;
    Ok(bytes.to_vec())
}

#[tauri::command]
pub async fn download_and_install_update(
    download_url: String,
    api_url: Option<String>,
) -> Result<String, String> {
    #[cfg(windows)]
    {
        let url = reqwest::Url::parse(&download_url).map_err(|_| "Invalid installer URL")?;
        if !release_link(&download_url, true) || !url.path().to_ascii_lowercase().ends_with(".exe")
        {
            return Err(
                "Installer must be a Windows executable from Coucou's GitHub releases".into(),
            );
        }
        // The browser URL names the file; for a private build the API URL is the
        // only transport that can carry the token.
        let token = update_token();
        let bytes = match (token.as_deref(), api_url.as_deref()) {
            (Some(token), Some(api)) if api_asset_link(api) => {
                fetch_with_token(api, token).await?
            }
            _ => {
                let client = reqwest::Client::builder()
                    .user_agent(USER_AGENT)
                    .timeout(std::time::Duration::from_secs(180))
                    .build()
                    .map_err(|e| e.to_string())?;
                let resp = client
                    .get(url)
                    .send()
                    .await
                    .map_err(|e| format!("Download request failed: {e}"))?;
                if !resp.status().is_success() {
                    return Err(format!("Download failed with status: {}", resp.status()));
                }
                resp.bytes()
                    .await
                    .map_err(|e| format!("Failed to read response body: {e}"))?
                    .to_vec()
            }
        };
        let installer_path = std::env::temp_dir().join("Coucou-Update-Setup.exe");
        std::fs::write(&installer_path, &bytes)
            .map_err(|e| format!("Failed to write installer file: {e}"))?;
        Command::new(&installer_path)
            .spawn()
            .map_err(|e| format!("Failed to launch installer: {e}"))?;
        Ok("Installer launched".into())
    }
    #[cfg(target_os = "macos")]
    {
        // The browser carries the user's own GitHub session, so a private
        // repository's DMG link opens for whoever may read it.
        let _ = api_url;
        let url = reqwest::Url::parse(&download_url).map_err(|_| "Invalid release URL")?;
        let dmg =
            release_link(&download_url, true) && url.path().to_ascii_lowercase().ends_with(".dmg");
        if !dmg && !release_link(&download_url, false) {
            return Err(
                "Open a macOS DMG or Coucou's GitHub release page for manual installation".into(),
            );
        }
        Command::new("/usr/bin/open")
            .arg(&download_url)
            .spawn()
            .map_err(|e| format!("Failed to open download page: {e}"))?;
        Ok("Opened for manual installation".into())
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (download_url, api_url);
        Err(
            "Direct installation is only supported on Windows; open the release page instead"
                .into(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_version_compare() {
        assert!(is_newer("0.1.0", "0.1.1"));
        assert!(is_newer("0.1.0", "0.2.0"));
        assert!(is_newer("0.1.0", "1.0.0"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.1.1", "0.1.0"));
        assert!(is_newer("0.1.0", "v0.1.1"));
    }

    fn release(names: &[&str]) -> Value {
        json!({ "assets": names.iter().enumerate().map(|(i, name)| json!({
            "name": name,
            "browser_download_url": format!("https://github.com/{GITHUB_REPO}/releases/download/v1.0.0/{name}"),
            "url": format!("https://api.github.com/repos/{GITHUB_REPO}/releases/assets/{}", 100 + i),
        })).collect::<Vec<_>>() })
    }

    #[test]
    fn mac_selects_only_matching_or_universal_dmg() {
        let assets = release(&[
            "Coucou-setup.exe",
            "Coucou_universal.dmg",
            "Coucou_x64.dmg",
            "Coucou_aarch64.dmg",
        ]);
        assert_eq!(
            select_asset(&assets, "macos", "aarch64").unwrap().name,
            "Coucou_aarch64.dmg"
        );
        assert_eq!(
            select_asset(&assets, "macos", "x86_64").unwrap().name,
            "Coucou_x64.dmg"
        );
        assert_eq!(
            select_asset(&release(&["Coucou_universal.dmg"]), "macos", "aarch64")
                .unwrap()
                .name,
            "Coucou_universal.dmg"
        );
        assert!(select_asset(
            &release(&["Coucou_x64.dmg", "Coucou-setup.exe", "Coucou.dmg"]),
            "macos",
            "aarch64"
        )
        .is_none());
        assert!(select_asset(&assets, "linux", "x86_64").is_none());
    }

    #[test]
    fn windows_keeps_setup_preference() {
        let assets = release(&["Coucou.exe", "Coucou_aarch64.dmg", "Coucou-setup.exe"]);
        assert_eq!(
            select_asset(&assets, "windows", "x86_64").unwrap().name,
            "Coucou-setup.exe"
        );
    }

    #[test]
    fn the_selected_installer_carries_both_ways_to_fetch_it() {
        let asset = select_asset(&release(&["Coucou-setup.exe"]), "windows", "x86_64").unwrap();
        assert!(asset.browser_url.ends_with("/download/v1.0.0/Coucou-setup.exe"));
        // A private build downloads through the API endpoint, so it has to survive
        // validation and come from this repository's own release.
        assert!(asset.api_url.as_deref().is_some_and(api_asset_link));
    }

    #[test]
    fn api_asset_urls_are_scoped_to_this_repository() {
        let ok = format!("https://api.github.com/repos/{GITHUB_REPO}/releases/assets/12345");
        assert!(api_asset_link(&ok), "{ok}");
        let other = if GITHUB_REPO == "other/repo" { "someone/else" } else { "other/repo" };
        for url in [
            format!("http://api.github.com/repos/{GITHUB_REPO}/releases/assets/1"),
            format!("https://api.github.com/repos/{other}/releases/assets/1"),
            format!("https://api.github.com/repos/{GITHUB_REPO}/releases/assets/abc"),
            format!("https://api.github.com/repos/{GITHUB_REPO}/releases/assets/1?x=1"),
            format!("https://api.github.com.evil.test/repos/{GITHUB_REPO}/releases/assets/1"),
        ] {
            assert!(!api_asset_link(&url), "{url}");
        }
    }

    #[test]
    fn the_signed_redirect_must_stay_on_a_github_asset_host() {
        assert!(asset_redirect(
            "https://release-assets.githubusercontent.com/github-production-release-asset/1/x"
        ));
        assert!(asset_redirect("https://objects.githubusercontent.com/x?sig=1"));
        assert!(!asset_redirect("https://githubusercontent.com.evil.test/x"));
        assert!(!asset_redirect("http://release-assets.githubusercontent.com/x"));
        assert!(!asset_redirect("https://evil.test/x"));
    }

    #[test]
    fn only_a_fork_is_a_private_channel() {
        // Whatever this checkout is, the flag follows the compile-time repository
        // and nothing else: the public build must never ask for a token.
        assert_eq!(private_channel(), GITHUB_REPO != PUBLIC_REPO);
    }

    #[test]
    fn release_urls_reject_external_or_non_release_links() {
        // The build's own repository is the only accepted host and path, whatever
        // it happens to be, so the fixtures follow the compile-time repo.
        let asset = format!("https://github.com/{GITHUB_REPO}/releases/download/v1/Coucou.exe");
        let page = format!("https://github.com/{GITHUB_REPO}/releases/tag/v1");
        assert!(release_link(&asset, true), "{asset}");
        assert!(release_link(&page, false), "{page}");
        // A repository that is certainly not this one, so the prefix check bites.
        let other = if GITHUB_REPO == "other/repo" { "someone/else" } else { "other/repo" };
        for url in [
            format!("http://github.com/{GITHUB_REPO}/releases/download/v1/Coucou.exe"),
            format!("https://github.com.evil.test/{GITHUB_REPO}/releases/download/v1/Coucou.exe"),
            format!("https://github.com/{other}/releases/download/v1/Coucou.exe"),
            format!("https://github.com/{GITHUB_REPO}/blob/main/Coucou.exe"),
            format!("https://github.com/{GITHUB_REPO}/releases/download/v1/Coucou.exe?x=1"),
        ] {
            assert!(!release_link(&url, true), "{url}");
        }
    }
}
