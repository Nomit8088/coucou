// Online update checker for Coucou (Windows)
// Fetches the latest release from GitHub Releases API and triggers download/install.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::process::Command;

const GITHUB_REPO: &str = "Nomit8088/coucou";
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
    let latest_version = tag_name.trim_start_matches(|c: char| !c.is_ascii_digit()).to_string();
    let release_notes = json.get("body").and_then(Value::as_str).unwrap_or("").to_string();
    let release_url = json.get("html_url").and_then(Value::as_str).unwrap_or("").to_string();

    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let has_update = is_newer(&current_version, &latest_version);

    let mut download_url = None;
    let mut file_name = None;

    if let Some(assets) = json.get("assets").and_then(Value::as_array) {
        for asset in assets {
            if let Some(name) = asset.get("name").and_then(Value::as_str) {
                if name.ends_with("-setup.exe") || name.ends_with(".exe") {
                    if let Some(durl) = asset.get("browser_download_url").and_then(Value::as_str) {
                        download_url = Some(durl.to_string());
                        file_name = Some(name.to_string());
                        if name.ends_with("-setup.exe") {
                            break;
                        }
                    }
                }
            }
        }
    }

    Ok(UpdateInfo {
        has_update,
        current_version,
        latest_version,
        release_notes,
        release_url,
        download_url,
        file_name,
    })
}

#[tauri::command]
pub async fn download_and_install_update(download_url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&download_url)
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

    let temp_dir = std::env::temp_dir();
    let installer_path = temp_dir.join("Coucou-Update-Setup.exe");

    std::fs::write(&installer_path, &bytes)
        .map_err(|e| format!("Failed to write installer file: {e}"))?;

    #[cfg(windows)]
    {
        Command::new(&installer_path)
            .spawn()
            .map_err(|e| format!("Failed to launch installer: {e}"))?;
    }

    #[cfg(not(windows))]
    {
        return Err("Direct installation is only supported on Windows".into());
    }

    Ok("Installer launched".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version_compare() {
        assert!(is_newer("0.1.0", "0.1.1"));
        assert!(is_newer("0.1.0", "0.2.0"));
        assert!(is_newer("0.1.0", "1.0.0"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.1.1", "0.1.0"));
        assert!(is_newer("0.1.0", "v0.1.1"));
    }
}
