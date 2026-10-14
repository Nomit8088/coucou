// Integration pollers — the Rust side of StripePoller / GithubPoller /
// VercelPoller / N8nPoller / ResendPoller / NotionPoller / CalcomPoller.
//
// Same endpoints, same first-run delays and intervals as the Swift pollers. Each
// one emits an `integration` event; the island owns the badge, the sound and the
// 60 s auto-clear, exactly as the Swift handlers do.
//
// Nothing is polled until its key exists in the Credential Manager, and no
// request goes anywhere the user has not configured.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Notify;

use crate::github::{self, GitHubActivity, GitHubPulse};
use crate::island::WINDOW_LABEL;
use crate::log;
use crate::secrets;

const TIMEOUT: Duration = Duration::from_secs(10);

/// What the island receives. `event` is only set when something actually changed,
/// which is what drives the pill badge and the sound.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationUpdate {
    pub id: &'static str,
    pub data: Value,
    pub error: Option<String>,
    pub event: Option<IntegrationEvent>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationEvent {
    pub success: bool,
    pub label: String,
    pub detail: Option<String>,
}

fn emit(app: &AppHandle, update: IntegrationUpdate) {
    let _ = app.emit_to(WINDOW_LABEL, "integration", update);
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .unwrap_or_default()
}

/// Set from the tray's Pause item. While it is on, nothing reaches the network:
/// pausing Coucou has to mean pausing Coucou, not just hiding the island.
pub static PAUSED: AtomicBool = AtomicBool::new(false);

pub fn set_paused(on: bool) {
    PAUSED.store(on, Ordering::Relaxed);
}

/// Spawns every poller with the macOS delays and intervals.
pub fn start(app: AppHandle) {
    spawn(app.clone(), "integration_resend", 6, 60, poll_resend);
    spawn(app.clone(), "integration_github", 7, 300, poll_github);
    spawn_github_loops(app.clone());
    spawn(app.clone(), "integration_gitlab", 8, 60, poll_gitlab);
    // The DevOps card changes on a human's timescale, and its API answers a
    // hundred rows at a time: five minutes is plenty, and far kinder than a
    // tighter loop on an endpoint that also serves the web UI.
    spawn(app.clone(), "integration_kingeye", 10, 300, poll_kingeye);
    // A mailbox is read every five minutes, never more: IMAP signs in again
    // each time, and nobody needs a second's notice for an email.
    spawn(app, "integration_qqmail", 9, 300, poll_qqmail);
}

/// True when the user has this integration switched on in settings.
fn enabled(app: &AppHandle, id: &str) -> bool {
    app.try_state::<crate::Shared>()
        .map(|shared| {
            let settings = shared.settings.lock().unwrap();
            settings.active_integrations.iter().any(|x| x == id)
        })
        .unwrap_or(false)
}

fn git_watch(app: &AppHandle, github: bool) -> crate::settings::GitWatch {
    app.try_state::<crate::Shared>()
        .map(|shared| {
            let settings = shared.settings.lock().unwrap();
            if github { settings.github_watch } else { settings.gitlab_watch }
        })
        .unwrap_or_default()
}

fn spawn<F, Fut>(app: AppHandle, id: &'static str, delay_secs: u64, every_secs: u64, poll: F)
where
    F: Fn(AppHandle) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = ()> + Send,
{
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(delay_secs)).await;
        let mut ticker = tokio::time::interval(Duration::from_secs(every_secs));
        loop {
            ticker.tick().await;
            // The ticker keeps its cadence; we just decline to do the work. An
            // integration the user switched off, or a paused app, must make no
            // network calls at all — CLAUDE.md allows talking only to services
            // the user configured, and a disabled one is not configured.
            if PAUSED.load(Ordering::Relaxed) || !enabled(&app, id) {
                continue;
            }
            poll(app.clone()).await;
        }
    });
}

/// One-shot refresh from the Refresh buttons in the island.
pub async fn poll_once(app: AppHandle, id: &str) {
    match id {
        "integration_github" => {
            wake_github_pulse();
            github_refresh_if_stale("activity");
            poll_github(app).await
        }
        "integration_resend" => poll_resend(app).await,
        "integration_gitlab" => poll_gitlab(app).await,
        "integration_kingeye" => poll_kingeye(app).await,
        "integration_qqmail" => poll_qqmail(app).await,
        _ => {}
    }
}

/// Remembers the newest id per integration so an event fires once, not on every poll.
struct Seen(Mutex<std::collections::HashMap<&'static str, String>>);

static SEEN: std::sync::LazyLock<Seen> =
    std::sync::LazyLock::new(|| Seen(Mutex::new(std::collections::HashMap::new())));

/// Returns true the first time a given id is seen (and false on the very first
/// load, which only fills the card).
fn is_new(key: &'static str, id: &str) -> bool {
    let mut map = SEEN.0.lock().unwrap();
    match map.insert(key, id.to_string()) {
        Some(previous) => previous != id,
        None => false, // first poll: populate silently, like the Swift pollers
    }
}

/// The card's error line, in the interface language (i18n.rs);
/// `unauthorised_hint` comes translated.
fn status_error(code: u16, unauthorised_hint: &str) -> String {
    match code {
        401 => crate::i18n::t("Invalid API key (401)"),
        403 => unauthorised_hint.to_string(),
        _ => crate::i18n::tf("API error {code}", &[("code", &code.to_string())]),
    }
}

// ── Stripe ────────────────────────────────────────────────────────────────────

async fn poll_stripe(app: AppHandle) {
    let Some(key) = secrets::get("stripe-api-key") else { return };
    let auth = format!("Basic {}", crate::claude::base64_for(format!("{key}:").as_bytes()));
    let http = client();

    let balance = http
        .get("https://api.stripe.com/v1/balance")
        .header("Authorization", &auth)
        .send()
        .await;

    let (amount, currency) = match balance {
        Ok(r) if r.status().is_success() => {
            let json: Value = r.json().await.unwrap_or(json!({}));
            let mut buckets: Vec<Value> = Vec::new();
            for k in ["available", "pending"] {
                if let Some(arr) = json.get(k).and_then(Value::as_array) {
                    buckets.extend(arr.iter().cloned());
                }
            }
            let currency = buckets
                .first()
                .and_then(|b| b.get("currency"))
                .and_then(Value::as_str)
                .unwrap_or("eur")
                .to_string();
            let amount: i64 = buckets
                .iter()
                .filter_map(|b| b.get("amount").and_then(Value::as_i64))
                .sum();
            (amount, currency)
        }
        Ok(r) => {
            let code = r.status().as_u16();
            emit(&app, IntegrationUpdate {
                id: "integration_stripe",
                data: json!({}),
                error: Some(status_error(code, &crate::i18n::t("Use a secret key (sk_live_… not pk_live_…)"))),
                event: None,
            });
            return;
        }
        Err(e) => {
            emit(&app, IntegrationUpdate {
                id: "integration_stripe",
                data: json!({}),
                error: Some(crate::i18n::tf("No connection: {error}", &[("error", &e.to_string())])),
                event: None,
            });
            return;
        }
    };

    let charges = http
        .get("https://api.stripe.com/v1/charges?limit=3")
        .header("Authorization", &auth)
        .send()
        .await;
    let Ok(response) = charges else { return };
    if !response.status().is_success() {
        return;
    }
    let json: Value = response.json().await.unwrap_or(json!({}));
    let payments: Vec<Value> = json
        .get("data")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|c| {
                    let description = c
                        .get("description")
                        .and_then(Value::as_str)
                        .or_else(|| {
                            c.get("billing_details")
                                .and_then(|b| b.get("name"))
                                .and_then(Value::as_str)
                        })
                        .map(str::to_string);
                    Some(json!({
                        "id": c.get("id")?.as_str()?,
                        "amount": c.get("amount")?.as_i64()?,
                        "currency": c.get("currency")?.as_str()?,
                        "description": description,
                        "createdAt": c.get("created").and_then(Value::as_i64).unwrap_or(0) * 1000,
                        "status": c.get("status").and_then(Value::as_str).unwrap_or("succeeded"),
                    }))
                })
                .collect()
        })
        .unwrap_or_default();

    let newest = payments
        .first()
        .and_then(|p| p.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let event = if !newest.is_empty() && is_new("stripe", &newest) {
        let label = payments[0]
            .get("description")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| {
                let cents = payments[0].get("amount").and_then(Value::as_i64).unwrap_or(0);
                format!("{:.2}", cents as f64 / 100.0)
            });
        Some(IntegrationEvent { success: true, label, detail: None })
    } else {
        None
    };

    emit(&app, IntegrationUpdate {
        id: "integration_stripe",
        data: json!({ "balance": amount, "currency": currency, "payments": payments }),
        error: None,
        event,
    });
}

// ── GitHub ────────────────────────────────────────────────────────────────────

async fn poll_github(app: AppHandle) {
    let Some(token) = secrets::get("github-token") else { return };
    let http = client();

    let user = http
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "Coucou")
        .send()
        .await;
    let Ok(response) = user else { return };
    if !response.status().is_success() {
        emit(&app, IntegrationUpdate {
            id: "integration_github",
            data: json!({}),
            error: Some(status_error(response.status().as_u16(), &crate::i18n::t("Token lacks the needed scope"))),
            event: None,
        });
        return;
    }
    let json: Value = response.json().await.unwrap_or(json!({}));
    let public = json.get("public_repos").and_then(Value::as_i64).unwrap_or(0);
    let private = json
        .get("owned_private_repos")
        .or_else(|| json.get("total_private_repos"))
        .and_then(Value::as_i64)
        .unwrap_or(0);

    let repos = http
        .get("https://api.github.com/user/repos?per_page=100&affiliation=owner&sort=pushed")
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "Coucou")
        .send()
        .await;
    let stars: i64 = match repos {
        Ok(r) if r.status().is_success() => r
            .json::<Value>()
            .await
            .ok()
            .and_then(|v| v.as_array().cloned())
            .map(|list| {
                list.iter()
                    .filter_map(|r| r.get("stargazers_count").and_then(Value::as_i64))
                    .sum()
            })
            .unwrap_or(0),
        _ => 0,
    };

    GITHUB.cache.lock().unwrap().stats = Some((public + private, stars));
    emit_github(&app);
}

// ── GitHub pulse and activity (GithubPoller.swift) ────────────────────────────
//
// Two more loops next to the stats above, with the Mac cadence: the pulse (my
// pull requests and their CI, reviews waiting for me, default-branch CI) 10 s
// after launch, then every 60 s while some CI is running and every 5 min
// otherwise; the contribution calendar 15 s after launch, then every 30 min.
// Neither touches the network while the pill is off or Coucou is paused, and
// the island wakes them when the card is opened on stale data.
//
// All three results are kept here and always sent together, so one poll never
// wipes what another one reported.

const GITHUB_ID: &str = "integration_github";

#[derive(Default)]
struct GitHubCache {
    /// (repositories, stars)
    stats: Option<(i64, i64)>,
    pulse: Option<GitHubPulse>,
    activity: Option<GitHubActivity>,
}

struct GitHubLoops {
    cache: Mutex<GitHubCache>,
    /// Bumped when the token changes: a response for the old token is dropped.
    generation: AtomicU64,
    pulse_wake: Notify,
    activity_wake: Notify,
    pulse_busy: AtomicBool,
    activity_busy: AtomicBool,
}

static GITHUB: std::sync::LazyLock<GitHubLoops> = std::sync::LazyLock::new(|| GitHubLoops {
    cache: Mutex::new(GitHubCache::default()),
    generation: AtomicU64::new(0),
    pulse_wake: Notify::new(),
    activity_wake: Notify::new(),
    pulse_busy: AtomicBool::new(false),
    activity_busy: AtomicBool::new(false),
});

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// What the island's GitHub card receives: whichever of the three is known.
fn github_card_data(cache: &GitHubCache) -> Value {
    let mut data = serde_json::Map::new();
    if let Some((repos, stars)) = cache.stats {
        data.insert("totalRepos".into(), json!(repos));
        data.insert("totalStars".into(), json!(stars));
    }
    if let Some(pulse) = &cache.pulse {
        data.insert("pulse".into(), serde_json::to_value(pulse).unwrap_or(Value::Null));
    }
    if let Some(activity) = &cache.activity {
        data.insert("activity".into(), serde_json::to_value(activity).unwrap_or(Value::Null));
    }
    Value::Object(data)
}

fn emit_github(app: &AppHandle) {
    let data = github_card_data(&GITHUB.cache.lock().unwrap());
    emit(app, IntegrationUpdate { id: GITHUB_ID, data, error: None, event: None });
}

fn spawn_github_loops(app: AppHandle) {
    let pulse_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut wait = Duration::from_secs(10);
        loop {
            // Sleeps for `wait`, or less when the island asks for fresh data.
            let _ = tokio::time::timeout(wait, GITHUB.pulse_wake.notified()).await;
            let pending = run_github_pulse(&pulse_app).await;
            wait = Duration::from_secs(if pending { 60 } else { 300 }); // pending includes open PRs (comments)
        }
    });
    tauri::async_runtime::spawn(async move {
        let mut wait = Duration::from_secs(15);
        loop {
            let _ = tokio::time::timeout(wait, GITHUB.activity_wake.notified()).await;
            run_github_activity(&app).await;
            wait = Duration::from_secs(1800);
        }
    });
}

/// One authenticated GraphQL call. Partial errors are logged (as a count) and the
/// data parsed anyway; only a response without `data` is dropped.
async fn github_graphql(token: &str, query: &str, what: &str) -> Option<Value> {
    let response = client()
        .post("https://api.github.com/graphql")
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .header("User-Agent", "Coucou")
        .json(&json!({ "query": query }))
        .send()
        .await;
    let Ok(response) = response else {
        log::line(format!("github {what}: no connection"));
        return None;
    };
    if !response.status().is_success() {
        log::line(format!("github {what} HTTP {}", response.status().as_u16()));
        return None;
    }
    let root: Value = response.json().await.ok()?;
    let errors = github::graphql_error_count(&root);
    if errors > 0 {
        log::line(format!("github {what} GraphQL errors: {errors}"));
    }
    root.get("data").filter(|d| d.is_object())?;
    Some(root)
}

/// Returns whether some CI is still running, which sets the next interval.
async fn run_github_pulse(app: &AppHandle) -> bool {
    if PAUSED.load(Ordering::Relaxed) || !enabled(app, GITHUB_ID) {
        return false;
    }
    let Some(token) = secrets::get("github-token") else { return false };
    let generation = GITHUB.generation.load(Ordering::SeqCst);
    GITHUB.pulse_busy.store(true, Ordering::SeqCst);
    let root = github_graphql(&token, github::PULSE_QUERY, "pulse").await;
    GITHUB.pulse_busy.store(false, Ordering::SeqCst);
    let Some(pulse) = root.and_then(|r| GitHubPulse::parse(&r, now_ms())) else { return false };
    let pending = pulse.wants_fast_poll();

    let events = {
        let mut cache = GITHUB.cache.lock().unwrap();
        // The token changed while this was in flight: it answers for someone else.
        if GITHUB.generation.load(Ordering::SeqCst) != generation {
            return pending;
        }
        let events = GitHubPulse::events(cache.pulse.as_ref(), &pulse, git_watch(app, true));
        cache.pulse = Some(pulse);
        events
    };
    emit_github(app);
    if !events.is_empty() {
        if events.iter().any(|e| matches!(e, github::GitHubEvent::Comments { .. })) {
            log::line("github: new comments");
        }
        let _ = app.emit_to(WINDOW_LABEL, "github-alerts", &events);
    }
    pending
}

async fn run_github_activity(app: &AppHandle) {
    if PAUSED.load(Ordering::Relaxed) || !enabled(app, GITHUB_ID) {
        return;
    }
    let Some(token) = secrets::get("github-token") else { return };
    let generation = GITHUB.generation.load(Ordering::SeqCst);
    GITHUB.activity_busy.store(true, Ordering::SeqCst);
    let root = github_graphql(&token, github::ACTIVITY_QUERY, "activity").await;
    GITHUB.activity_busy.store(false, Ordering::SeqCst);
    let Some(activity) = root.and_then(|r| GitHubActivity::parse(&r, now_ms())) else { return };
    {
        let mut cache = GITHUB.cache.lock().unwrap();
        if GITHUB.generation.load(Ordering::SeqCst) != generation {
            return;
        }
        cache.activity = Some(activity);
    }
    emit_github(app);
}

fn wake_github_pulse() {
    if !GITHUB.pulse_busy.load(Ordering::SeqCst) {
        GITHUB.pulse_wake.notify_one();
    }
}

/// The card was opened: fetch now if what it shows is older than the Mac's
/// limits (1 min for the pulse, 5 min for the activity grid). No-op while a
/// request is already in flight.
pub fn github_refresh_if_stale(section: &str) {
    let now = now_ms();
    let cache = GITHUB.cache.lock().unwrap();
    match section {
        "pulse" => {
            let fetched = cache.pulse.as_ref().map(|p| p.fetched_at);
            if !GITHUB.pulse_busy.load(Ordering::SeqCst) && github::is_stale(fetched, now, 60) {
                GITHUB.pulse_wake.notify_one();
            }
        }
        "activity" => {
            let fetched = cache.activity.as_ref().map(|a| a.fetched_at);
            if !GITHUB.activity_busy.load(Ordering::SeqCst) && github::is_stale(fetched, now, 300) {
                GITHUB.activity_wake.notify_one();
            }
        }
        _ => {}
    }
}

/// The GitHub token was saved or removed: forget what the old one fetched, drop
/// its requests still in flight, and fetch again right away.
pub fn github_token_changed(app: &AppHandle) {
    GITHUB.generation.fetch_add(1, Ordering::SeqCst);
    let has_token = secrets::get("github-token").is_some();
    {
        let mut cache = GITHUB.cache.lock().unwrap();
        cache.pulse = None;
        cache.activity = None;
        if !has_token {
            cache.stats = None;
        }
    }
    emit_github(app);
    GITHUB.pulse_wake.notify_one();
    GITHUB.activity_wake.notify_one();
    if has_token && !PAUSED.load(Ordering::Relaxed) && enabled(app, GITHUB_ID) {
        tauri::async_runtime::spawn(poll_github(app.clone()));
    }
}

/// Switching the pill off forgets the pulse, so switching it back on starts
/// silent instead of alerting on everything that changed in between.
pub fn settings_saved(app: &AppHandle, active_integrations: &[String]) {
    if active_integrations.iter().any(|id| id == GITHUB_ID) {
        return;
    }
    let had_data = {
        let mut cache = GITHUB.cache.lock().unwrap();
        let had = cache.pulse.is_some() || cache.activity.is_some();
        cache.pulse = None;
        cache.activity = None;
        had
    };
    if had_data {
        emit_github(app);
    }
}

// ── Vercel ────────────────────────────────────────────────────────────────────

async fn poll_vercel(app: AppHandle) {
    let Some(token) = secrets::get("vercel-token") else { return };
    let response = client()
        .get("https://api.vercel.com/v6/deployments?limit=5")
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/json")
        .send()
        .await;
    let Ok(response) = response else { return };
    if !response.status().is_success() {
        emit(&app, IntegrationUpdate {
            id: "integration_vercel",
            data: json!({}),
            error: Some(status_error(response.status().as_u16(), &crate::i18n::t("Token lacks access"))),
            event: None,
        });
        return;
    }
    let json: Value = response.json().await.unwrap_or(json!({}));
    let terminal = ["READY", "ERROR", "CANCELED"];
    let deployments: Vec<Value> = json
        .get("deployments")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|d| {
                    let state = d.get("state")?.as_str()?;
                    if !terminal.contains(&state) {
                        return None;
                    }
                    let meta = d.get("meta");
                    let pick = |keys: [&str; 3]| {
                        meta.and_then(|m| keys.iter().find_map(|k| m.get(*k).and_then(Value::as_str)))
                            .map(str::to_string)
                    };
                    Some(json!({
                        "id": d.get("uid")?.as_str()?,
                        "projectName": d.get("name")?.as_str()?,
                        "url": d.get("url").and_then(Value::as_str).unwrap_or(""),
                        "state": state,
                        "createdAt": d.get("createdAt").and_then(Value::as_f64).unwrap_or(0.0),
                        "commitMessage": pick(["githubCommitMessage", "gitlabCommitMessage", "bitbucketCommitMessage"]),
                        "branch": pick(["githubCommitRef", "gitlabCommitRef", "bitbucketBranch"]),
                    }))
                })
                .collect()
        })
        .unwrap_or_default();

    let event = deployments.first().and_then(|latest| {
        let id = latest.get("id")?.as_str()?;
        if !is_new("vercel", id) {
            return None;
        }
        let success = latest.get("state")?.as_str()? == "READY";
        Some(IntegrationEvent {
            success,
            label: latest.get("projectName")?.as_str()?.to_string(),
            detail: None,
        })
    });

    emit(&app, IntegrationUpdate {
        id: "integration_vercel",
        data: json!({ "deployments": deployments }),
        error: None,
        event,
    });
}

// ── Resend ────────────────────────────────────────────────────────────────────

async fn poll_resend(app: AppHandle) {
    let Some(key) = secrets::get("resend-api-key") else { return };
    let response = client()
        .get("https://api.resend.com/emails?limit=100")
        .header("Authorization", format!("Bearer {key}"))
        .header("Accept", "application/json")
        .send()
        .await;
    let Ok(response) = response else { return };
    if !response.status().is_success() {
        emit(&app, IntegrationUpdate {
            id: "integration_resend",
            data: json!({}),
            error: Some(status_error(response.status().as_u16(), &crate::i18n::t("Key lacks access"))),
            event: None,
        });
        return;
    }
    let json: Value = response.json().await.unwrap_or(json!({}));
    let total = json
        .get("total")
        .or_else(|| json.get("count"))
        .and_then(Value::as_i64);
    let emails: Vec<Value> = json
        .get("data")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .take(5)
                .filter_map(|e| {
                    let to = match e.get("to") {
                        Some(Value::Array(a)) => a.clone(),
                        Some(Value::String(s)) => vec![Value::String(s.clone())],
                        _ => vec![],
                    };
                    Some(json!({
                        "id": e.get("id")?.as_str()?,
                        "to": to,
                        "subject": e.get("subject").and_then(Value::as_str).unwrap_or(""),
                        "createdAt": e.get("created_at").and_then(Value::as_str).unwrap_or(""),
                        "lastEvent": e.get("last_event").and_then(Value::as_str).unwrap_or(""),
                    }))
                })
                .collect()
        })
        .unwrap_or_default();

    emit(&app, IntegrationUpdate {
        id: "integration_resend",
        data: json!({ "emails": emails, "total": total }),
        error: None,
        event: None,
    });
}

// ── QQ Mail ───────────────────────────────────────────────────────────────────

/// INBOX over IMAP (mail.rs): the unseen count and the newest unseen subjects.
/// Nothing is marked read, no body is fetched, nothing is ever sent, and the
/// connection is opened and closed within the poll.
async fn poll_qqmail(app: AppHandle) {
    let (Some(address), Some(code)) = (secrets::get("qqmail-address"), secrets::get("qqmail-auth-code")) else {
        return;
    };
    match crate::mail::fetch(&address, &code).await {
        Ok(mailbox) => {
            // The newest arrival gets the badge and the sound, once.
            let newest = mailbox.messages.last();
            let event = newest.filter(|m| is_new("qqmail", &m.uid.to_string())).map(|last| IntegrationEvent {
                success: true,
                label: if last.subject.is_empty() { last.from.clone() } else { last.subject.clone() },
                detail: Some(last.from.clone()),
            });
            emit(&app, IntegrationUpdate {
                id: "integration_qqmail",
                data: serde_json::to_value(&mailbox).unwrap_or_else(|_| json!({})),
                error: None,
                event,
            });
        }
        Err(crate::mail::Error::Auth) => emit(&app, IntegrationUpdate {
            id: "integration_qqmail",
            data: json!({}),
            error: Some(crate::i18n::t("Sign-in refused — check the authorisation code")),
            event: None,
        }),
        Err(err) => emit(&app, IntegrationUpdate {
            id: "integration_qqmail",
            data: json!({}),
            error: Some(crate::i18n::tf("No connection: {error}", &[("error", &err.to_string())])),
            event: None,
        }),
    }
}

// ── Notion ────────────────────────────────────────────────────────────────────

async fn poll_notion(app: AppHandle) {
    let Some(token) = secrets::get("notion-api-key") else { return };
    let response = client()
        .post("https://api.notion.com/v1/search")
        .header("Authorization", format!("Bearer {token}"))
        .header("Notion-Version", "2022-06-28")
        .header("Content-Type", "application/json")
        .json(&json!({
            "sort": { "direction": "descending", "timestamp": "last_edited_time" },
            "page_size": 3
        }))
        .send()
        .await;
    let Ok(response) = response else { return };
    if !response.status().is_success() {
        emit(&app, IntegrationUpdate {
            id: "integration_notion",
            data: json!({}),
            error: Some(status_error(response.status().as_u16(), &crate::i18n::t("Integration lacks access"))),
            event: None,
        });
        return;
    }
    let json: Value = response.json().await.unwrap_or(json!({}));
    let pages: Vec<Value> = json
        .get("results")
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(parse_notion_page).collect())
        .unwrap_or_default();

    emit(&app, IntegrationUpdate {
        id: "integration_notion",
        data: json!({ "pages": pages }),
        error: None,
        event: None,
    });
}

fn parse_notion_page(obj: &Value) -> Option<Value> {
    let id = obj.get("id")?.as_str()?;
    let is_database = obj.get("object").and_then(Value::as_str) == Some("database");

    let mut title = "Untitled".to_string();
    if is_database {
        if let Some(text) = obj
            .get("title")
            .and_then(Value::as_array)
            .and_then(|a| a.first())
            .and_then(|t| t.get("plain_text"))
            .and_then(Value::as_str)
        {
            if !text.is_empty() {
                title = text.to_string();
            }
        }
    } else if let Some(props) = obj.get("properties").and_then(Value::as_object) {
        for prop in props.values() {
            if prop.get("type").and_then(Value::as_str) != Some("title") {
                continue;
            }
            if let Some(text) = prop
                .get("title")
                .and_then(Value::as_array)
                .and_then(|a| a.first())
                .and_then(|t| t.get("plain_text"))
                .and_then(Value::as_str)
            {
                if !text.is_empty() {
                    title = text.to_string();
                    break;
                }
            }
        }
    }

    let emoji = obj
        .get("icon")
        .filter(|i| i.get("type").and_then(Value::as_str) == Some("emoji"))
        .and_then(|i| i.get("emoji"))
        .and_then(Value::as_str);

    Some(json!({
        "id": id,
        "title": title,
        "emoji": emoji,
        "lastEditedAt": obj.get("last_edited_time").and_then(Value::as_str)?,
        "url": obj.get("url").and_then(Value::as_str).unwrap_or("https://notion.so"),
    }))
}

// ── Cal.com ───────────────────────────────────────────────────────────────────

async fn poll_calcom(app: AppHandle) {
    let Some(key) = secrets::get("calcom-api-key") else { return };
    let response = client()
        .get("https://api.cal.com/v2/bookings?status=upcoming")
        .header("Authorization", format!("Bearer {key}"))
        .header("cal-api-version", "2024-08-13")
        .send()
        .await;
    let Ok(response) = response else { return };
    if !response.status().is_success() {
        emit(&app, IntegrationUpdate {
            id: "integration_calcom",
            data: json!({}),
            error: Some(status_error(response.status().as_u16(), &crate::i18n::t("Key lacks access"))),
            event: None,
        });
        return;
    }
    let json: Value = response.json().await.unwrap_or(json!({}));
    let bookings: Vec<Value> = json
        .get("data")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|b| {
                    let start = b
                        .get("start")
                        .or_else(|| b.get("startTime"))
                        .and_then(Value::as_str)?;
                    let attendee = b.get("attendees").and_then(Value::as_array).and_then(|a| a.first());
                    let notes = b
                        .get("responses")
                        .and_then(|r| r.get("notes"))
                        .and_then(|n| n.get("value"))
                        .and_then(Value::as_str)
                        .or_else(|| b.get("description").and_then(Value::as_str))
                        .filter(|s| !s.is_empty());
                    Some(json!({
                        "id": b.get("id").map(|v| v.to_string()).unwrap_or_default(),
                        "title": b.get("title").and_then(Value::as_str).unwrap_or("Meeting"),
                        "start": start,
                        "status": b.get("status").and_then(Value::as_str).unwrap_or("accepted"),
                        "attendeeName": attendee.and_then(|a| a.get("name")).and_then(Value::as_str),
                        "attendeeEmail": attendee.and_then(|a| a.get("email")).and_then(Value::as_str),
                        "attendeeNotes": notes,
                    }))
                })
                .collect()
        })
        .unwrap_or_default();

    emit(&app, IntegrationUpdate {
        id: "integration_calcom",
        data: json!({ "bookings": bookings }),
        error: None,
        event: None,
    });
}

// ── n8n ───────────────────────────────────────────────────────────────────────

async fn poll_n8n(app: AppHandle) {
    let (Some(key), Some(raw_base)) = (secrets::get("n8n-api-key"), secrets::get("n8n-url")) else {
        return;
    };
    let base = raw_base.trim_end_matches('/').to_string();
    let http = client();

    // Same two shapes as the Swift poller: the public API first, then /rest.
    let list_urls = [
        format!("{base}/api/v1/executions?limit=1&includeData=false"),
        format!("{base}/rest/executions?limit=1&includeData=false"),
    ];

    let mut items: Option<Vec<Value>> = None;
    for url in &list_urls {
        let Ok(response) = http.get(url).header("X-N8N-API-KEY", &key).header("Accept", "application/json").send().await
        else {
            continue;
        };
        if !response.status().is_success() {
            // Only the status: a self-hosted base URL can carry credentials.
            log::line(format!("n8n list HTTP {}", response.status()));
            continue;
        }
        let Ok(json) = response.json::<Value>().await else { continue };
        items = match &json {
            Value::Object(o) => o.get("data").and_then(Value::as_array).cloned(),
            Value::Array(a) => Some(a.clone()),
            _ => None,
        };
        if items.is_some() {
            break;
        }
    }

    let Some(first) = items.and_then(|list| list.into_iter().next()) else { return };
    let id = match first.get("id") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => return,
    };

    let status = first.get("status").and_then(Value::as_str).unwrap_or("");
    if !["success", "error", "crashed", "canceled", "failed"].contains(&status) {
        return;
    }
    if !is_new("n8n", &id) {
        return;
    }
    let success = status == "success";

    let detail_urls = [
        format!("{base}/api/v1/executions/{id}?includeData=true"),
        format!("{base}/api/v1/executions/{id}"),
        format!("{base}/rest/executions/{id}?includeData=true"),
        format!("{base}/rest/executions/{id}"),
    ];
    let mut name = crate::i18n::t("Workflow");
    let mut detail = None;
    for url in &detail_urls {
        let Ok(response) = http.get(url).header("X-N8N-API-KEY", &key).header("Accept", "application/json").send().await
        else {
            continue;
        };
        if !response.status().is_success() {
            continue;
        }
        let Ok(json) = response.json::<Value>().await else { continue };
        name = json
            .get("workflowData")
            .and_then(|w| w.get("name"))
            .and_then(Value::as_str)
            .or_else(|| json.get("name").and_then(Value::as_str))
            .map(str::to_string)
            .unwrap_or_else(|| crate::i18n::t("Workflow"));
        detail = n8n_detail(&json, success);
        break;
    }

    log::line(format!("n8n execution {id} {status} · {name}"));
    emit(&app, IntegrationUpdate {
        id: "integration_n8n",
        data: json!({ "workflow": name, "status": status }),
        error: None,
        event: Some(IntegrationEvent { success, label: name, detail }),
    });
}

fn n8n_detail(json: &Value, success: bool) -> Option<String> {
    let result = json.get("data")?.get("resultData")?;
    if !success {
        if let Some(error) = result.get("error") {
            let message = error.get("message").and_then(Value::as_str).unwrap_or("");
            if let Some(node) = error.get("node").and_then(|n| n.get("name")).and_then(Value::as_str) {
                if !node.is_empty() {
                    return Some(format!("{node}\n{message}"));
                }
            }
            return Some(message.to_string());
        }
        let runs = result.get("runData")?.as_object()?;
        for (node, value) in runs {
            if let Some(message) = value
                .as_array()
                .and_then(|a| a.first())
                .and_then(|r| r.get("error"))
                .and_then(|e| e.get("message"))
                .and_then(Value::as_str)
            {
                return Some(format!("{node}\n{message}"));
            }
        }
        return None;
    }

    let last_node = result.get("lastNodeExecuted")?.as_str()?;
    let items = result
        .get("runData")?
        .get(last_node)?
        .as_array()?
        .first()?
        .get("data")?
        .get("main")?
        .as_array()?
        .first()?
        .as_array()?;
    let count = items.len();
    let header = format!("→ {last_node} · {count} item{}", if count == 1 { "" } else { "s" });

    let fields = items
        .first()
        .and_then(|i| i.get("json"))
        .and_then(Value::as_object)
        .map(|obj| {
            obj.iter()
                .take(4)
                .map(|(k, v)| format!("{k}: {}", fmt_value(v)))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .filter(|s| !s.is_empty());

    Some(match fields {
        Some(f) => format!("{header}\n{f}"),
        None => header,
    })
}

fn fmt_value(v: &Value) -> String {
    match v {
        Value::String(s) => s.chars().take(50).collect(),
        Value::Array(a) => format!("[{}]", a.len()),
        Value::Object(_) => "{…}".into(),
        other => other.to_string(),
    }
}

// ── GitLab (enterprise) ───────────────────────────────────────────────────────

struct GitlabCache {
    fetched_at: u64,
    running: bool,
    pulse: Option<crate::gitlab::GitlabPulse>,
}

static GITLAB: Mutex<GitlabCache> = Mutex::new(GitlabCache { fetched_at: 0, running: false, pulse: None });

fn gitlab_base() -> Option<(reqwest::Url, String)> {
    let raw = secrets::get("gitlab-url")?;
    let token = secrets::get("gitlab-token").filter(|t| !t.trim().is_empty())?;
    let url = reqwest::Url::parse(raw.trim()).ok()?;
    if url.host_str().is_none() {
        return None;
    }
    let ok = url.scheme() == "https" || (url.scheme() == "http" && crate::net::is_loopback_url(&url));
    if !ok || !url.username().is_empty() {
        return None;
    }
    let mut origin = url;
    origin.set_path("");
    origin.set_query(None);
    origin.set_fragment(None);
    Some((origin, token))
}

fn gitlab_link(base: &reqwest::Url, web_url: Option<&str>, fallback_path: &str) -> String {
    if let Some(web_url) = web_url {
        if let Ok(parsed) = reqwest::Url::parse(web_url) {
            if parsed.host_str() == base.host_str() {
                return web_url.to_string();
            }
        }
    }
    let mut url = base.clone();
    url.set_path(fallback_path);
    url.to_string()
}

async fn gitlab_get(base: &reqwest::Url, token: &str, path: &str) -> Option<Value> {
    let url = format!("{}{}", base.as_str().trim_end_matches('/'), path);
    let response = client()
        .get(url)
        .header("PRIVATE-TOKEN", token)
        .header("Accept", "application/json")
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json().await.ok()
}

async fn gitlab_graphql(base: &reqwest::Url, token: &str, query: &str) -> Option<Value> {
    let url = format!("{}{}", base.as_str().trim_end_matches('/'), "/api/graphql");
    let response = client()
        .post(url)
        .header("PRIVATE-TOKEN", token)
        .header("Content-Type", "application/json")
        .json(&json!({ "query": query }))
        .send()
        .await
        .ok()?;
    let status = response.status().as_u16();
    if !response.status().is_success() {
        log::line(format!("gitlab graphql HTTP {status}"));
        return None;
    }
    let root: Value = response.json().await.ok()?;
    let errors = root.get("errors").and_then(Value::as_array).map(Vec::len).unwrap_or(0);
    if errors > 0 {
        log::line(format!("gitlab graphql errors: {errors}"));
    }
    if root.get("data").and_then(|d| d.get("currentUser")).and_then(Value::as_object).is_none() {
        return None;
    }
    Some(root)
}

fn encode_project(path: &str) -> String {
    path.replace('/', "%2F")
}

/// Notes are not on the pipeline query: enterprise GitLab rejects `notes(filter:)`
/// and that used to fail the whole pulse. A dedicated query, then REST for any
/// MR it did not fill. `old` lets a failed fetch keep the last good note list.
async fn gitlab_attach_notes(
    base: &reqwest::Url,
    token: &str,
    pulse: &mut crate::gitlab::GitlabPulse,
    old: Option<&crate::gitlab::GitlabPulse>,
) {
    if let Some(root) = gitlab_graphql(base, token, crate::gitlab::NOTES_QUERY).await {
        pulse.apply_notes_payload(&root);
    } else {
        log::line("gitlab notes graphql unavailable — REST");
    }
    if pulse.review.iter().any(|mr| !mr.notes_fetched) {
        if let Some(root) = gitlab_graphql(base, token, crate::gitlab::REVIEW_NOTES_QUERY).await {
            pulse.apply_notes_payload(&root);
        }
    }
    let pending = pulse.notes_pending();
    for (project, iid, id) in pending.into_iter().take(12) {
        let path = format!(
            "/api/v4/projects/{}/merge_requests/{iid}/notes?per_page=20&sort=desc&order_by=created_at",
            encode_project(&project),
        );
        let Some(body) = gitlab_get(base, token, &path).await else { continue };
        pulse.set_notes(&id, crate::gitlab::rest_comments(&body));
    }
    pulse.seal_notes(old);
}

async fn gitlab_fill_pipelines(base: &reqwest::Url, token: &str, mrs: &mut [crate::gitlab::GitlabMr]) {
    for mr in mrs.iter_mut().take(20) {
        if mr.ci != crate::github::CiState::Unknown {
            continue;
        }
        let Some(pid) = mr.project_id else { continue };
        let path = format!("/api/v4/projects/{pid}/merge_requests/{}/pipelines?per_page=1", mr.iid);
        let Some(list) = gitlab_get(base, token, &path).await else { continue };
        if let Some(row) = list.as_array().and_then(|a| a.first()) {
            crate::gitlab::apply_pipeline_row(mr, row);
        }
    }
}

#[allow(dead_code)]
fn gitlab_pipelines(base: &reqwest::Url, list: Option<&Value>) -> (Vec<Value>, bool) {
    let mut out = Vec::new();
    let mut running = false;
    for row in list.and_then(Value::as_array).into_iter().flatten().take(3) {
        let status = row.get("status").and_then(Value::as_str).unwrap_or("");
        if status == "running" || status == "pending" {
            running = true;
        }
        let pid = row.get("id").and_then(Value::as_i64).unwrap_or(0);
        let name = row
            .get("project")
            .and_then(|p| p.get("path_with_namespace"))
            .and_then(Value::as_str)
            .unwrap_or("");
        // /pipelines answers refs the way git spells them ("refs/heads/main");
        // the card wants the branch.
        let git_ref = row.get("ref").and_then(Value::as_str).unwrap_or("");
        let branch = git_ref
            .strip_prefix("refs/heads/")
            .or_else(|| git_ref.strip_prefix("refs/tags/"))
            .unwrap_or(git_ref);
        // /pipelines carries the project's own web_url, so this fallback is only
        // ever reached for a row without one.
        let fallback = if name.is_empty() {
            format!("/-/pipelines/{pid}")
        } else {
            format!("/{name}/-/pipelines/{pid}")
        };
        out.push(json!({
            "id": pid,
            "status": status,
            "ref": branch,
            "project": name,
            "url": gitlab_link(base, row.get("web_url").and_then(Value::as_str), &fallback),
        }));
    }
    (out, running)
}

#[allow(dead_code)]
fn gitlab_mrs(base: &reqwest::Url, list: Option<&Value>) -> Vec<Value> {
    list.and_then(Value::as_array)
        .map(|items| {
            items.iter().take(8).filter_map(|mr| {
                let iid = mr.get("iid").and_then(Value::as_i64)?;
                let title = mr.get("title").and_then(Value::as_str).unwrap_or("");
                let project = mr.get("references").and_then(|r| r.get("full")).and_then(Value::as_str).unwrap_or("");
                Some(json!({
                    "iid": iid,
                    "title": title,
                    "project": project,
                    "url": gitlab_link(base, mr.get("web_url").and_then(Value::as_str), &format!("/-/merge_requests/{iid}")),
                    "updatedAt": mr.get("updated_at").and_then(Value::as_str).unwrap_or(""),
                }))
            }).collect()
        })
        .unwrap_or_default()
}

async fn poll_gitlab(app: AppHandle) {
    poll_gitlab_force(&app, false).await;
}

async fn poll_gitlab_force(app: &AppHandle, force: bool) {
    if PAUSED.load(Ordering::Relaxed) || !enabled(app, "integration_gitlab") {
        return;
    }
    let Some((base, token)) = gitlab_base() else { return };
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    {
        let cache = GITLAB.lock().unwrap();
        let interval = if cache.running { 60 } else { 300 };
        if !force && cache.fetched_at != 0 && now.saturating_sub(cache.fetched_at) < interval {
            return;
        }
    }
    let watch = git_watch(app, false);
    let pulse = if let Some(root) = gitlab_graphql(&base, &token, crate::gitlab::GRAPHQL_QUERY).await {
        let mut pulse = crate::gitlab::GitlabPulse::parse(&root, now);
        if let Some(pulse) = pulse.as_mut() {
            if let Some(review) = gitlab_graphql(&base, &token, crate::gitlab::GRAPHQL_REVIEW_QUERY).await {
                pulse.merge_review(&review);
            }
        }
        pulse
    } else {
        None
    };
    let mut pulse = if let Some(pulse) = pulse {
        pulse
    } else {
        log::line("gitlab graphql unavailable — REST pipelines");
        let user = gitlab_get(&base, &token, "/api/v4/user").await;
        let login = user
            .as_ref()
            .and_then(|u| u.get("username").and_then(Value::as_str))
            .unwrap_or("")
            .to_string();
        let mine = gitlab_get(&base, &token, "/api/v4/merge_requests?state=opened&scope=created_by_me&per_page=20").await;
        let assigned = gitlab_get(&base, &token, "/api/v4/merge_requests?state=opened&scope=assigned_to_me&per_page=20").await;
        let mut review = gitlab_get(&base, &token, "/api/v4/merge_requests?state=opened&scope=to_be_reviewed&per_page=20").await;
        if review.is_none() {
            review = gitlab_get(&base, &token, "/api/v4/merge_requests?state=opened&reviewer_id=me&per_page=20").await;
        }
        let mut pulse = crate::gitlab::GitlabPulse::from_rest(login, mine.as_ref(), assigned.as_ref(), review.as_ref(), now);
        gitlab_fill_pipelines(&base, &token, &mut pulse.mine).await;
        gitlab_fill_pipelines(&base, &token, &mut pulse.assigned).await;
        gitlab_fill_pipelines(&base, &token, &mut pulse.review).await;
        pulse
    };
    let old_pulse = GITLAB.lock().unwrap().pulse.clone();
    gitlab_attach_notes(&base, &token, &mut pulse, old_pulse.as_ref()).await;
    let (pipelines, running) = pulse.card_pipelines();
    let events = {
        let mut cache = GITLAB.lock().unwrap();
        let events = crate::gitlab::GitlabPulse::events(cache.pulse.as_ref(), &pulse, watch);
        cache.fetched_at = now;
        cache.running = running || pulse.wants_fast_poll();
        cache.pulse = Some(pulse.clone());
        events
    };
    emit(app, IntegrationUpdate {
        id: "integration_gitlab",
        data: json!({
            "mine": crate::gitlab::GitlabPulse::card_mrs(&pulse.mine),
            "review": crate::gitlab::GitlabPulse::card_mrs(&pulse.review),
            "pipelines": pipelines,
            "host": base.as_str().trim_end_matches('/'),
        }),
        error: None,
        event: None,
    });
    if !events.is_empty() {
        if events.iter().any(|e| matches!(e, crate::gitlab::GitlabEvent::Comments { .. })) {
            log::line("gitlab: new comments");
        }
        let _ = app.emit_to(WINDOW_LABEL, "gitlab-alerts", &events);
    }
}

pub fn gitlab_refresh_if_stale(app: &AppHandle) {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let stale = {
        let cache = GITLAB.lock().unwrap();
        cache.fetched_at == 0 || now.saturating_sub(cache.fetched_at) >= 60
    };
    if stale {
        let app = app.clone();
        tauri::async_runtime::spawn(async move { poll_gitlab_force(&app, true).await });
    }
}

// ── Kingeye (CTeam DevOps) ────────────────────────────────────────────────────
//
// The requirements and defects this login is involved in, from the CTeam public
// OpenAPI: `POST /api/open/CTeam/api/service_open/issue/2.1.0/basic` with an
// `X-DEVOPS-ACCESS-TOKEN` header. Only the pages the token is allowed to read
// are asked for, and no request is made until both the token and the login are
// configured.

/// What one work item looks like once kingeye::card_item has it.
static KINGEYE_SEEN: std::sync::LazyLock<Mutex<std::collections::HashSet<String>>> =
    std::sync::LazyLock::new(|| Mutex::new(std::collections::HashSet::new()));
static KINGEYE_SEEDED: AtomicBool = AtomicBool::new(false);
static KINGEYE_FETCHED_AT: AtomicU64 = AtomicU64::new(0);

/// The token, the login, and the host the links must stay on.
///
/// The login is required rather than guessed: a CTeam login ("timon") is not the
/// OS account name ("nomit"), and guessing wrong would quietly count nothing at
/// all instead of saying so.
fn kingeye_config() -> Option<(String, String, String)> {
    let token = secrets::get("kingeye-token").filter(|t| !t.trim().is_empty())?;
    let login = secrets::get("kingeye-login").filter(|l| !l.trim().is_empty())?;
    let origin = secrets::get("kingeye-url")
        .map(|u| u.trim().trim_end_matches('/').to_string())
        .filter(|u| u.starts_with("https://") || u.starts_with("http://"))
        .unwrap_or_else(|| crate::kingeye::DEFAULT_ORIGIN.to_string());
    Some((token, login.trim().to_string(), origin))
}

fn kingeye_prefs(app: &AppHandle) -> crate::settings::KingeyePrefs {
    app.try_state::<crate::Shared>()
        .map(|shared| shared.settings.lock().unwrap().kingeye.clone())
        .unwrap_or_default()
}

/// One page of one kind in the given projects, newest first (the API answers
/// newest-first on its own, which is why nothing is sorted here).
///
/// `Err(status)` carries the HTTP status behind a failure so the card can say
/// what went wrong; 0 means the answer never arrived or was not JSON.
async fn kingeye_page(
    client: &reqwest::Client,
    origin: &str,
    token: &str,
    login: &str,
    projects: &[String],
    classify: &str,
    size: usize,
    user_filter: Option<(&str, &str)>,
) -> Result<Vec<Value>, u16> {
    let url = format!("{origin}/api/open/CTeam/api/service_open/issue/2.1.0/basic");
    let mut filters = crate::kingeye::query_filters(projects, classify);
    if let (Some(arr), Some((k, v))) = (filters.as_array_mut(), user_filter) {
        arr.push(json!({ "name": k, "value": [v] }));
    }
    let response = client
        .post(&url)
        .query(&[("userId", login), ("num", "1"), ("size", &size.to_string())])
        .header("X-DEVOPS-ACCESS-TOKEN", token)
        .header("Accept", "application/json")
        .json(&filters)
        .send()
        .await
        .map_err(|_| 0u16)?;
    let status = response.status().as_u16();
    if !response.status().is_success() {
        log::line(format!("kingeye HTTP {status}"));
        return Err(status);
    }
    let root: Value = response.json().await.map_err(|_| 0u16)?;
    // The gateway answers 200 with its own status in the body.
    if root.get("status").and_then(Value::as_i64).unwrap_or(0) != 0 {
        let message = root.get("message").and_then(Value::as_str).unwrap_or("");
        log::line(format!("kingeye API error: {message}"));
        // A rejected token comes back this way, with the HTTP code still 200.
        return Err(if message.contains("validate fail") { 401 } else { 0 });
    }
    Ok(root
        .get("data")
        .and_then(|d| d.get("content"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default())
}

async fn poll_kingeye(app: AppHandle) {
    if PAUSED.load(Ordering::Relaxed) || !enabled(&app, "integration_kingeye") {
        return;
    }
    let Some((token, login, origin)) = kingeye_config() else { return };
    let prefs = kingeye_prefs(&app);
    let assign_id = secrets::get("kingeye-assign-id").unwrap_or_default();
    let projects = if prefs.projects.is_empty() {
        vec!["aiops".to_string()]
    } else {
        prefs.projects.clone()
    };
    let http = client();

    let mut records: Vec<Value> = Vec::new();
    let mut first_error: Option<u16> = None;
    for classify in ["BUG", "DEMAND"] {
        // 1. operator_user (经办人)
        if let Ok(page) = kingeye_page(&http, &origin, &token, &login, &projects, classify, 50, Some(("operator_user", &login))).await {
            for mut it in page {
                if let Some(obj) = it.as_object_mut() {
                    obj.insert("_matched".to_string(), json!(true));
                }
                records.push(it);
            }
        }
        // 2. developers (开发人员)
        if let Ok(page) = kingeye_page(&http, &origin, &token, &login, &projects, classify, 50, Some(("developers", &login))).await {
            for mut it in page {
                if let Some(obj) = it.as_object_mut() {
                    obj.insert("_matched".to_string(), json!(true));
                }
                records.push(it);
            }
        }
        // 3. createUser (创建人)
        if let Ok(page) = kingeye_page(&http, &origin, &token, &login, &projects, classify, 50, Some(("createUser", &login))).await {
            for mut it in page {
                if let Some(obj) = it.as_object_mut() {
                    obj.insert("_matched".to_string(), json!(true));
                }
                records.push(it);
            }
        }
        // 4. Global newest pool (for touched / updateUser, only if enabled)
        if prefs.include_touched {
            match kingeye_page(&http, &origin, &token, &login, &projects, classify, 100, None).await {
                Ok(mut page) => records.append(&mut page),
                Err(status) => first_error = first_error.or(Some(status)),
            }
        }
    }
    if records.is_empty() {
        if let Some(status) = first_error {
            // 0 means nothing was heard at all — say that rather than "API error 0".
            let error = if status == 0 {
                crate::i18n::tf("No connection: {error}", &[("error", &origin)])
            } else {
                status_error(status, &crate::i18n::t("Token lacks the needed scope"))
            };
            emit(&app, IntegrationUpdate {
                id: "integration_kingeye",
                data: json!({}),
                error: Some(error),
                event: None,
            });
        }
        return;
    }

    // Deduplicate by issue ID so records added via creator search don't double-count.
    let mut seen_ids = std::collections::HashSet::new();
    records.retain(|r| {
        r.get("id")
            .and_then(Value::as_str)
            .map(|id| seen_ids.insert(id.to_string()))
            .unwrap_or(true)
    });

    if !prefs.versions.is_empty() {
        // Pre-filter candidates: only query details for items that belong to the user,
        // match target states, and don't already have the version in their title.
        let candidate_indices: Vec<usize> = records
            .iter()
            .enumerate()
            .filter_map(|(idx, record)| {
                if !crate::kingeye::is_mine(record, &login, &assign_id, prefs.include_touched) {
                    return None;
                }
                let state = record.get("stateCn").and_then(Value::as_str).unwrap_or("");
                let classify = record.get("typeClassify").and_then(Value::as_str).unwrap_or("");
                let states = if classify == "DEMAND" {
                    prefs.effective_demand_states()
                } else {
                    prefs.effective_bug_states()
                };
                if !crate::kingeye::state_kept(state, states) {
                    return None;
                }
                let title = record.get("title").and_then(Value::as_str).unwrap_or("");
                if crate::kingeye::title_matches_versions(title, &prefs.versions) {
                    return None;
                }
                let id = record.get("id").and_then(Value::as_str).unwrap_or("");
                let project = record.get("projectId").and_then(Value::as_str).unwrap_or("");
                if id.is_empty() || project.is_empty() {
                    return None;
                }
                Some(idx)
            })
            .take(15)
            .collect();

        if !candidate_indices.is_empty() {
            let mut handles = Vec::new();
            for &idx in &candidate_indices {
                let record = &records[idx];
                let id = record.get("id").and_then(Value::as_str).unwrap_or("").to_string();
                let project = record.get("projectId").and_then(Value::as_str).unwrap_or("").to_string();
                let url = format!("{origin}/api/open/CTeam/api/service_open/issue/2.1.0/{project}/{id}?userId={login}");
                let client = http.clone();
                let token_clone = token.clone();
                handles.push(tauri::async_runtime::spawn(async move {
                    if let Ok(res) = client.get(&url).header("X-DEVOPS-ACCESS-TOKEN", &token_clone).send().await {
                        if let Ok(val) = res.json::<Value>().await {
                            if let Some(disp) = val.get("data")
                                .and_then(|d| d.get("property"))
                                .and_then(|p| p.get("version"))
                                .and_then(|v| v.get("displayValue"))
                                .and_then(Value::as_str)
                            {
                                return (idx, Some(disp.to_string()));
                            }
                        }
                    }
                    (idx, None)
                }));
            }
            for handle in handles {
                if let Ok((idx, Some(ver))) = handle.await {
                    if let Some(obj) = records[idx].as_object_mut() {
                        obj.insert("version".to_string(), json!(ver));
                    }
                }
            }
        }
    }

    let (items, requirements, defects) = crate::kingeye::select(
        &records,
        &origin,
        &login,
        &assign_id,
        prefs.include_touched,
        &prefs.versions,
        prefs.effective_demand_states(),
        prefs.effective_bug_states(),
    );

    let ids: Vec<String> = items
        .iter()
        .filter_map(|i| i.get("id").and_then(Value::as_str).map(str::to_string))
        .collect();

    let fresh = {
        let mut seen = KINGEYE_SEEN.lock().unwrap();
        let mut seeded = KINGEYE_SEEDED.load(Ordering::Relaxed);
        let fresh = crate::kingeye::new_ids(&mut seen, &ids, &mut seeded);
        KINGEYE_SEEDED.store(seeded, Ordering::Relaxed);
        fresh
    };

    let fresh_rows: Vec<Value> = items
        .iter()
        .filter(|i| {
            i.get("id")
                .and_then(Value::as_str)
                .map(|id| fresh.iter().any(|f| f == id))
                .unwrap_or(false)
        })
        .cloned()
        .collect();

    let _event = if fresh_rows.is_empty() {
        None
    } else {
        let first = &fresh_rows[0];
        let label = first
            .get("number")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let detail = first
            .get("title")
            .and_then(Value::as_str)
            .map(str::to_string);
        Some(IntegrationEvent { success: true, label, detail })
    };

    KINGEYE_FETCHED_AT.store(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        Ordering::Relaxed,
    );

    emit(&app, IntegrationUpdate {
        id: "integration_kingeye",
        data: json!({
            "items": items,
            "requirements": requirements,
            "defects": defects,
            "login": login,
            "host": origin,
            "fresh": fresh_rows,
        }),
        error: None,
        event: None,
    });
    // The rows themselves, so the island's notice can name what is new — the
    // island handles the badge, the sound and the notice card.
    if !fresh_rows.is_empty() {
        let _ = app.emit_to(WINDOW_LABEL, "kingeye-alerts", &fresh_rows);
    }
}

/// The card came on screen: refetch if the last answer is more than a minute old.
pub fn kingeye_refresh_if_stale(app: &AppHandle) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let fetched = KINGEYE_FETCHED_AT.load(Ordering::Relaxed);
    if fetched == 0 || now.saturating_sub(fetched) >= 60 {
        let app = app.clone();
        tauri::async_runtime::spawn(async move { poll_kingeye(app).await });
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_card_data_sends_only_what_is_known() {
        let mut cache = GitHubCache::default();
        assert_eq!(github_card_data(&cache), json!({}));
        cache.stats = Some((12, 3400));
        assert_eq!(github_card_data(&cache), json!({ "totalRepos": 12, "totalStars": 3400 }));
        cache.activity = Some(GitHubActivity { total: 5, weeks: vec![], fetched_at: 9 });
        let data = github_card_data(&cache);
        assert_eq!(data["totalRepos"], json!(12));
        assert_eq!(data["activity"], json!({ "total": 5, "weeks": [], "fetchedAt": 9 }));
        assert!(data.get("pulse").is_none());
    }

    fn gitlab_test_base() -> reqwest::Url {
        reqwest::Url::parse("https://gitlab.example.com").unwrap()
    }

    #[test]
    fn a_gitlab_pipeline_row_keeps_its_project_and_its_branch() {
        let base = gitlab_test_base();
        let list = json!([{
            "id": 47,
            "status": "success",
            "ref": "refs/heads/main",
            "web_url": "https://gitlab.example.com/foo/bar/-/pipelines/47",
            "project": { "path_with_namespace": "foo/bar" },
        }]);
        let (rows, running) = gitlab_pipelines(&base, Some(&list));
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], json!(47));
        assert_eq!(rows[0]["project"], json!("foo/bar"));
        // The card shows a branch, not the way git spells one.
        assert_eq!(rows[0]["ref"], json!("main"));
        assert_eq!(rows[0]["url"], json!("https://gitlab.example.com/foo/bar/-/pipelines/47"));
        assert!(!running);
    }

    #[test]
    fn a_running_or_pending_gitlab_pipeline_keeps_the_poll_short() {
        let base = gitlab_test_base();
        for status in ["running", "pending"] {
            let list = json!([{ "id": 1, "status": status, "ref": "main" }]);
            assert!(gitlab_pipelines(&base, Some(&list)).1, "{status}");
        }
        for status in ["success", "failed", "canceled", "skipped"] {
            let list = json!([{ "id": 1, "status": status, "ref": "main" }]);
            assert!(!gitlab_pipelines(&base, Some(&list)).1, "{status}");
        }
    }

    #[test]
    fn gitlab_pipelines_never_show_more_than_three() {
        let base = gitlab_test_base();
        let list = json!((1..=9).map(|i| json!({ "id": i, "status": "success", "ref": "main" })).collect::<Vec<_>>());
        assert_eq!(gitlab_pipelines(&base, Some(&list)).0.len(), 3);
        assert_eq!(gitlab_pipelines(&base, None).0.len(), 0);
    }

    #[test]
    fn a_gitlab_pipeline_url_stays_on_the_configured_host() {
        let base = gitlab_test_base();
        // A web_url from another host is never a link the user asked for.
        let list = json!([{
            "id": 5,
            "status": "failed",
            "ref": "main",
            "web_url": "https://evil.example.org/foo/bar/-/pipelines/5",
            "project": { "path_with_namespace": "foo/bar" },
        }]);
        let rows = gitlab_pipelines(&base, Some(&list)).0;
        assert_eq!(rows[0]["url"], json!("https://gitlab.example.com/foo/bar/-/pipelines/5"));
    }
}
