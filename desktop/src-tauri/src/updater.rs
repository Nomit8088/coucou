// GitHub release updates: launch the installer on Windows, manual download on
// macOS. Unsupported targets must never fetch or write a Windows executable.

use serde::{Deserialize, Serialize};
use serde_json::Value;
#[cfg(any(windows, target_os = "macos"))]
use std::process::Command;

/// `owner/repo` this build reads releases from. `build.rs` sets it from the
/// checkout's `origin` (or `COUCOU_UPDATE_REPO`), so a private mirror updates
/// from itself while a plain build keeps reading the public repository.
const GITHUB_REPO: &str = match option_env!("COUCOU_UPDATE_REPO") {
    Some(repo) => repo,
    None => "Nomit8088/coucou",
};
const USER_AGENT: &str = "Coucou-App";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_notes: String,
    pub release_url: String,
    pub download_url: Option<String>,
    pub file_name: Option<String>,
    /// The repository this build updates from, so the UI never hardcodes one.
    pub repo: String,
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

fn select_asset(json: &Value, os: &str, arch: &str) -> Option<(String, String)> {
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
            Some((rank, url.to_string(), name.to_string()))
        })
        .min_by_key(|(rank, _, _)| *rank)
        .map(|(_, url, name)| (url, name))
}

#[tauri::command]
pub async fn check_for_update() -> Result<UpdateInfo, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("https://api.github.com/repos/{GITHUB_REPO}/releases/latest");
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("GitHub API returned status: {}", resp.status()));
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
    let (download_url, file_name) = asset
        .map(|(url, name)| (Some(url), Some(name)))
        .unwrap_or_default();

    Ok(UpdateInfo {
        has_update,
        current_version,
        latest_version,
        release_notes,
        release_url,
        download_url,
        file_name,
        repo: GITHUB_REPO.to_string(),
    })
}

#[tauri::command]
pub async fn download_and_install_update(download_url: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        let url = reqwest::Url::parse(&download_url).map_err(|_| "Invalid installer URL")?;
        if !release_link(&download_url, true) || !url.path().to_ascii_lowercase().ends_with(".exe")
        {
            return Err(
                "Installer must be a Windows executable from Coucou's GitHub releases".into(),
            );
        }
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
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("Failed to read response body: {e}"))?;
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
        let _ = download_url;
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
        json!({ "assets": names.iter().map(|name| json!({
            "name": name,
            "browser_download_url": format!("https://github.com/{GITHUB_REPO}/releases/download/v1.0.0/{name}"),
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
            select_asset(&assets, "macos", "aarch64").unwrap().1,
            "Coucou_aarch64.dmg"
        );
        assert_eq!(
            select_asset(&assets, "macos", "x86_64").unwrap().1,
            "Coucou_x64.dmg"
        );
        assert_eq!(
            select_asset(&release(&["Coucou_universal.dmg"]), "macos", "aarch64")
                .unwrap()
                .1,
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
            select_asset(&assets, "windows", "x86_64").unwrap().1,
            "Coucou-setup.exe"
        );
    }

    #[test]
    fn release_urls_reject_external_or_non_release_links() {
        assert!(release_link(
            "https://github.com/Nomit8088/coucou/releases/download/v1/Coucou.exe",
            true
        ));
        assert!(release_link(
            "https://github.com/Nomit8088/coucou/releases/tag/v1",
            false
        ));
        for url in [
            "http://github.com/Nomit8088/coucou/releases/download/v1/Coucou.exe",
            "https://github.com.evil.test/Nomit8088/coucou/releases/download/v1/Coucou.exe",
            "https://github.com/other/repo/releases/download/v1/Coucou.exe",
            "https://github.com/Nomit8088/coucou/blob/main/Coucou.exe",
            "https://github.com/Nomit8088/coucou/releases/download/v1/Coucou.exe?x=1",
        ] {
            assert!(!release_link(url, true), "{url}");
        }
    }
}
