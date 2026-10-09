// DeepSeek Harness: copy the Cordis plugin and insert one row, id `coucou`,
// into the profile's cordis.patch.yml. Same preview / backup / confirm rules
// as the other agents (config_file.rs). The plugin id is a contract: do not
// rename it.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::config_file::{self, FileEdit, Plan};
use crate::platform;
use crate::settings;

const PLUGIN_JS: &str = include_str!("../../dsh-plugin/index.js");
const PLUGIN_MANIFEST: &str = include_str!("../../dsh-plugin/package.json");
const MARKER_BEGIN: &str = "# coucou-dsh-begin";
const MARKER_END: &str = "# coucou-dsh-end";
const ROW_ID: &str = "coucou";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DshStatus {
    pub id: &'static str,
    pub name: &'static str,
    pub installed: bool,
    pub path: String,
    pub hook_ready: bool,
    pub approvals: bool,
    pub note: String,
    pub profile: String,
}

pub fn plugin_dir() -> PathBuf {
    settings::local_dir().join("dsh-plugin")
}

pub fn default_profile() -> PathBuf {
    platform::home_dir().join(".dsh").join("profiles").join("web")
}

pub fn profile_dir(settings: &crate::settings::Settings) -> PathBuf {
    let custom = settings.dsh_profile.trim();
    if custom.is_empty() {
        default_profile()
    } else {
        PathBuf::from(custom)
    }
}

fn patch_path(profile: &Path) -> PathBuf {
    profile.join("cordis.patch.yml")
}

fn pipe_names() -> (String, String) {
    let key = platform::current_user_sid()
        .unwrap_or_else(|| std::env::var("USERNAME").unwrap_or_else(|_| "user".into()));
    (
        format!(r"\\.\pipe\coucou-{key}"),
        format!(r"\\.\pipe\coucou-dsh-{key}"),
    )
}

fn yaml_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn block(plugin: &Path) -> String {
    let (pipe, steer) = pipe_names();
    // A directory file URL is not a valid ESM import. Point at index.js.
    let name = plugin.join("index.js").to_string_lossy().replace('\\', "/");
    format!(
        "{MARKER_BEGIN}\n- insert:\n    - id: {ROW_ID}\n      name: {}\n      config:\n        pipe: {}\n        steerPipe: {}\n{MARKER_END}\n",
        yaml_quote(&name),
        yaml_quote(&pipe),
        yaml_quote(&steer),
    )
}

fn strip_block(text: &str) -> String {
    let mut out = String::new();
    let mut skipping = false;
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim();
        if trimmed == MARKER_BEGIN {
            skipping = true;
            continue;
        }
        if skipping {
            if trimmed == MARKER_END {
                skipping = false;
            }
            continue;
        }
        out.push_str(line);
    }
    if out.trim().is_empty() {
        "[]\n".to_string()
    } else {
        out
    }
}

fn install_text(current: Option<&str>, plugin: &Path) -> String {
    let base = strip_block(current.unwrap_or("[]\n"));
    let mut text = base.trim_end().to_string();
    if text == "[]" {
        text.clear();
    }
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(&block(plugin));
    text
}

pub fn installed_at(profile: &Path) -> bool {
    let plugin_ok = plugin_dir().join("index.js").is_file() && plugin_dir().join("package.json").is_file();
    let patch = std::fs::read_to_string(patch_path(profile)).unwrap_or_default();
    plugin_ok && patch.contains("id: coucou") && patch.contains(MARKER_BEGIN)
}

pub fn installed() -> bool {
    installed_at(&default_profile())
}

pub fn status(settings: &crate::settings::Settings) -> DshStatus {
    let profile = profile_dir(settings);
    DshStatus {
        id: "dsh",
        name: "DeepSeek Harness",
        installed: installed_at(&profile),
        path: format!("{}\n{}", plugin_dir().display(), patch_path(&profile).display()),
        hook_ready: true,
        approvals: true,
        note: crate::i18n::t("Restart DeepSeek Harness to load the plugin. The running process does not pick this up."),
        profile: profile.display().to_string(),
    }
}

fn edits(profile: &Path, install: bool) -> Vec<FileEdit<'static>> {
    let patch = patch_path(profile);
    let plugin = plugin_dir();
    let label = patch.display().to_string();
    let plugin_for_text = plugin.clone();
    let patch_edit = FileEdit {
        path: patch,
        edit: config_file::text_edit(label, move |current| {
            if install {
                Ok(Some(install_text(current, &plugin_for_text)))
            } else {
                Ok(Some(strip_block(current.unwrap_or(""))))
            }
        }),
    };
    // The plugin files are Coucou's. Installing overwrites them; uninstall
    // removes only those two files, not the directory of a file we didn't write.
    let js = FileEdit {
        path: plugin.join("index.js"),
        edit: config_file::text_edit("dsh-plugin/index.js".into(), move |current| {
            if !install {
                if current.is_some_and(|text| !text.contains("generated by Coucou") && !text.trim().is_empty()) {
                    return Err(crate::i18n::t("The DSH plugin file wasn't written by Coucou — Coucou has not touched it."));
                }
                return Ok(None);
            }
            if current.is_some_and(|text| !text.contains("generated by Coucou") && !text.trim().is_empty()) {
                return Err(crate::i18n::t("The DSH plugin file wasn't written by Coucou — Coucou has not touched it."));
            }
            Ok(Some(PLUGIN_JS.to_string()))
        }),
    };
    let manifest = FileEdit {
        path: plugin.join("package.json"),
        edit: config_file::text_edit("dsh-plugin/package.json".into(), move |current| {
            if !install {
                return Ok(None);
            }
            if current.is_some_and(|text| !text.contains("@local/coucou-dsh") && !text.trim().is_empty()) {
                return Err(crate::i18n::t("The DSH plugin manifest wasn't written by Coucou — Coucou has not touched it."));
            }
            Ok(Some(PLUGIN_MANIFEST.to_string()))
        }),
    };
    vec![patch_edit, js, manifest]
}

pub fn preview(settings: &crate::settings::Settings, install: bool) -> Result<Plan, String> {
    config_file::preview(&edits(&profile_dir(settings), install))
}

pub fn apply(settings: &crate::settings::Settings, install: bool, fingerprint: &str) -> Result<String, String> {
    let backups = config_file::apply(&edits(&profile_dir(settings), install), fingerprint)?;
    Ok(backups.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join("\n"))
}

/// One line for the reverse pipe. Failure means DSH is not listening; the
/// caller falls back to the island chat and does not surface an error.
pub fn steer(text: &str) -> bool {
    send(&serde_json::json!({ "kind": "steer", "text": text }))
}

/// Stops the turn DSH is running. False means the plugin is not listening.
pub fn cancel() -> bool {
    send(&serde_json::json!({ "kind": "cancel" }))
}

/// A dropped file, as the prompt text that carries it. The path only: Coucou
/// never inlines a file's contents into another tool, and DSH reads it itself
/// with its own tools and its own sandbox rules.
pub fn steer_file(name: &str, path: &str) -> bool {
    let question = if name.trim().is_empty() { path } else { name };
    send(&serde_json::json!({
        "kind": "steer",
        "text": format!("I dropped a file: {question}\n{path}"),
    }))
}

/// Switch DSH permission preset for the current session.
pub fn set_preset(preset: &str) -> bool {
    send(&serde_json::json!({
        "kind": "preset",
        "preset": preset,
    }))
}

fn send(payload: &serde_json::Value) -> bool {
    #[cfg(windows)]
    {
        use std::io::Write;
        let (_, pipe) = pipe_names();
        let mut file = match std::fs::OpenOptions::new().read(true).write(true).open(&pipe) {
            Ok(file) => file,
            Err(_) => return false,
        };
        // One line: the plugin reads up to the first newline.
        let mut line = payload.to_string().replace(['\r', '\n'], " ");
        line.push('\n');
        file.write_all(line.as_bytes()).is_ok()
    }
    #[cfg(not(windows))]
    {
        let _ = payload;
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_appends_a_marked_block_and_uninstall_removes_only_that() {
        let plugin = Path::new(r"C:\Users\me\AppData\Local\Coucou\dsh-plugin");
        let existing = "- id: ui-theme\n  name: theme\n";
        let installed = install_text(Some(existing), plugin);
        assert!(installed.contains("id: coucou"));
        assert!(installed.contains("ui-theme"));
        assert!(installed.starts_with("- id: ui-theme"));
        let removed = strip_block(&installed);
        assert!(!removed.contains("coucou"));
        assert!(removed.contains("ui-theme"));
    }

    #[test]
    fn an_empty_patch_becomes_only_the_coucou_block() {
        let installed = install_text(Some("[]\n"), Path::new("/tmp/dsh-plugin"));
        assert!(installed.contains(MARKER_BEGIN));
        assert!(!installed.contains("[]"));
    }
}
