use std::process::Command;

/// Where a build takes its updates from when nothing says otherwise.
const PUBLIC_REPO: &str = "Nomit8088/coucou";

fn main() {
    // A build belongs to the repository it was checked out from: a private
    // mirror must look for its own releases, not the public ones. `origin`
    // decides that at compile time; an explicit `COUCOU_UPDATE_REPO` wins, which
    // is how a differently-hosted build picks its channel without editing code.
    let repo = update_repo();
    println!("cargo:rustc-env=COUCOU_UPDATE_REPO={repo}");
    println!("cargo:rerun-if-env-changed=COUCOU_UPDATE_REPO");
    // Switching remotes changes no tracked file, so watch the config as well.
    println!("cargo:rerun-if-changed=../../.git/config");
    tauri_build::build()
}

/// `owner/repo` of this checkout: the explicit override, else `origin`, else the
/// public repository.
fn update_repo() -> String {
    if let Some(repo) = std::env::var("COUCOU_UPDATE_REPO").ok().and_then(|v| normalize(&v)) {
        return repo;
    }
    let from_git = Command::new("git")
        .args(["config", "--get", "remote.origin.url"])
        .output()
        .ok()
        .filter(|out| out.status.success())
        .and_then(|out| normalize(&String::from_utf8_lossy(&out.stdout)));
    from_git.unwrap_or_else(|| PUBLIC_REPO.to_string())
}

/// Turns `https://github.com/owner/repo.git`, `git@github.com:owner/repo` or a
/// bare `owner/repo` into `owner/repo`. Anything that is not a GitHub repository
/// is rejected rather than guessed at.
fn normalize(raw: &str) -> Option<String> {
    let mut s = raw.trim();
    s = s.strip_suffix('/').unwrap_or(s);
    s = s.strip_suffix(".git").unwrap_or(s);
    s = s.strip_suffix('/').unwrap_or(s);
    if s.is_empty() {
        return None;
    }

    // scheme://[user@]host/owner/repo
    if let Some(rest) = s.split_once("://").map(|(_, rest)| rest) {
        let mut parts = rest.split('/');
        let host = host_of(parts.next()?)?;
        let owner = parts.next()?;
        let repo = parts.next()?;
        if parts.next().is_some() || !is_github(&host) {
            return None;
        }
        return join_two(owner, repo);
    }

    // [user@]host:owner/repo — the scp-like form git prints for SSH remotes.
    if let Some((head, tail)) = s.split_once(':') {
        if head.contains('/') {
            return normalize_two_segments(s);
        }
        if !is_github(&host_of(head)?) {
            return None;
        }
        return normalize_two_segments(tail);
    }

    normalize_two_segments(s)
}

/// `git@github.com` → `github.com`; a bare `github.com` stays as it is.
fn host_of(segment: &str) -> Option<String> {
    let host = segment.rsplit('@').next()?.to_ascii_lowercase();
    if host.is_empty() {
        None
    } else {
        Some(host)
    }
}

fn is_github(host: &str) -> bool {
    host == "github.com" || host == "www.github.com"
}

/// Bare `owner/repo`, used when there is no transport in front of it.
fn normalize_two_segments(s: &str) -> Option<String> {
    let (owner, repo) = s.split_once('/')?;
    if repo.contains('/') {
        return None;
    }
    join_two(owner, repo)
}

fn join_two(owner: &str, repo: &str) -> Option<String> {
    let ok = |part: &str| {
        !part.is_empty()
            && part != "."
            && part != ".."
            && part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
    };
    if ok(owner) && ok(repo) {
        Some(format!("{owner}/{repo}"))
    } else {
        None
    }
}
