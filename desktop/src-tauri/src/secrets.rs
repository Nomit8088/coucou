// API keys live in the Windows Credential Manager or, on Linux, the Secret
// Service (GNOME Keyring, KWallet) — never on disk and never in the front end — the island can only ask whether a key is present.

use keyring::Entry;

const SERVICE: &str = "fr.louisraille.coucou";

/// Every key Coucou may store. Anything outside this list is refused.
pub const KNOWN_KEYS: &[&str] = &[
    "anthropic-api-key",
    "openai-api-key",
    "google-api-key",
    "openrouter-api-key",
    "openai-compatible-key",
    "n8n-url",
    "n8n-api-key",
    "vercel-token",
    "github-token",
    "stripe-api-key",
    "resend-api-key",
    "notion-api-key",
    "calcom-api-key",
    "deepseek-api-key",
    "gitlab-url",
    "gitlab-token",
    // QQ Mail: the mailbox's own address, and the 16-character authorisation
    // code QQ's settings hand out for third-party clients (mail.rs).
    "qqmail-address",
    "qqmail-auth-code",
];

/// Custom chat providers get one credential each: `chat-` plus a short id.
fn is_chat_provider_key(key: &str) -> bool {
    let Some(rest) = key.strip_prefix("chat-") else { return false };
    (1..=32).contains(&rest.len())
        && rest.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn allowed(key: &str) -> bool {
    KNOWN_KEYS.contains(&key) || is_chat_provider_key(key)
}

fn entry(key: &str) -> Option<Entry> {
    if !allowed(key) {
        return None;
    }
    Entry::new(SERVICE, key).ok()
}

pub fn get(key: &str) -> Option<String> {
    entry(key)?.get_password().ok().filter(|v| !v.is_empty())
}

pub fn set(key: &str, value: &str) -> Result<(), String> {
    let entry = entry(key).ok_or_else(|| format!("unknown key {key}"))?;
    if value.is_empty() {
        let _ = entry.delete_credential();
        return Ok(());
    }
    entry.set_password(value).map_err(|e| e.to_string())
}

pub fn clear(key: &str) -> Result<(), String> {
    let entry = entry(key).ok_or_else(|| format!("unknown key {key}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn present(key: &str) -> bool {
    get(key).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deepseek_and_gitlab_credentials_are_allowed() {
        for key in ["deepseek-api-key", "gitlab-url", "gitlab-token", "chat-c-abc"] {
            assert!(allowed(key), "{key}");
        }
        assert!(!allowed("chat-"));
        assert!(!allowed("gitlab-token-extra"));
        assert!(!allowed("../gitlab-token"));
    }
}
