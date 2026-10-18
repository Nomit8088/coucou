// Settings → Diagnostics: the facts a bug report needs, collected in one place.
//
// Nothing secret is read here: API keys live in the OS keychain (secrets.rs),
// chat history is not touched, and settings.json is only inspected for Coucou's
// own hooks (hooks::status). The settings window (src/core/diagnostics.ts) turns
// this struct into the text that goes on the clipboard, so the summary can be
// tested without a running app.

use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::hooks::HookStatus;

/// Lines of the log kept at the end of the report.
const LOG_TAIL_LINES: usize = 200;
/// Hard cap on the log tail, so a report stays pasteable.
const LOG_TAIL_BYTES: usize = 16 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsInfo {
    pub app_version: String,
    pub identifier: String,
    pub os: String,
    pub arch: String,
    pub settings_path: String,
    pub local_dir: String,
    pub log_path: String,
    /// The last LOG_TAIL_LINES lines of the log, "" when it cannot be read.
    pub log_tail: String,
    pub hook: HookStatus,
    pub settings: Summary,
}

/// The preferences a maintainer may need to reproduce a bug. Everything else
/// (sync tokens, project lists, watch settings) stays out on purpose.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub language: String,
    pub main_pill: String,
    pub active_integrations: Vec<String>,
    pub screen: String,
    pub sound_enabled: bool,
    pub sound_volume: f64,
    pub autostart: bool,
    pub hooks_installed: bool,
    pub plan_relay_installed: bool,
    pub show_plan_in_notch: bool,
    pub show_codex_plan_in_notch: bool,
    pub chat_provider: String,
    pub model: String,
    pub dsh_profile: String,
}

pub fn info(app: &AppHandle) -> DiagnosticsInfo {
    let settings = crate::settings::load();
    let log_path = crate::settings::local_dir().join("coucou.log");
    DiagnosticsInfo {
        app_version: app.package_info().version.to_string(),
        identifier: app.config().identifier.clone(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        settings_path: crate::hooks::settings_path().to_string_lossy().to_string(),
        local_dir: crate::settings::local_dir().to_string_lossy().to_string(),
        log_tail: tail(&log_path, LOG_TAIL_LINES, LOG_TAIL_BYTES),
        log_path: log_path.to_string_lossy().to_string(),
        hook: crate::hooks::status(),
        settings: Summary {
            language: settings.language,
            main_pill: settings.main_pill,
            active_integrations: settings.active_integrations,
            screen: settings.screen,
            sound_enabled: settings.sound_enabled,
            sound_volume: settings.sound_volume,
            autostart: settings.autostart,
            hooks_installed: settings.hooks_installed,
            plan_relay_installed: settings.plan_relay_installed,
            show_plan_in_notch: settings.show_plan_in_notch,
            show_codex_plan_in_notch: settings.show_codex_plan_in_notch,
            chat_provider: settings.chat_provider,
            model: settings.model,
            dsh_profile: settings.dsh_profile,
        },
    }
}

/// The last `max_lines` lines of a UTF-8 file, reading at most `max_bytes` from
/// the end. A partial first line (the cut landed mid-line) is dropped; an
/// unreadable or missing file reads as "no log", never an error.
fn tail(path: &Path, max_lines: usize, max_bytes: usize) -> String {
    let Ok(bytes) = std::fs::read(path) else { return String::new() };
    let start = bytes.len().saturating_sub(max_bytes);
    let mut text = String::from_utf8_lossy(&bytes[start..]).into_owned();
    if start > 0 {
        match text.split_once('\n') {
            Some((_, rest)) => text = rest.to_string(),
            None => text.clear(),
        }
    }
    let mut lines: Vec<&str> = text.lines().collect();
    if lines.len() > max_lines {
        lines = lines.split_off(lines.len() - max_lines);
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_log(name: &str, text: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("coucou-diagnostics-{}-{name}.log", std::process::id()));
        std::fs::write(&path, text).unwrap();
        path
    }

    #[test]
    fn the_tail_keeps_the_last_lines_in_order() {
        let path = temp_log("lines", "one\ntwo\nthree\nfour\n");
        assert_eq!(tail(&path, 2, 1024), "three\nfour");
        assert_eq!(tail(&path, 10, 1024), "one\ntwo\nthree\nfour");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn the_tail_drops_a_line_cut_by_the_byte_cap_and_never_fails() {
        // Seven bytes from the end start mid-line: "hree\nfour" loses "hree".
        let path = temp_log("bytes", "one\ntwo\nthree\nfour\n");
        assert_eq!(tail(&path, 10, 7), "four");
        assert_eq!(tail(&path, 10, 0), "");
        let _ = std::fs::remove_file(&path);

        // A missing file is "no log", not an error and not a panic.
        assert_eq!(tail(&path, 10, 1024), "");
    }
}
