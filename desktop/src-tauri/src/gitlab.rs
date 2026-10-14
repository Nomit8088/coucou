// GitLab pulse — merge requests I created, assigned, or was asked to review,
// plus their head pipeline and comments. Parsing and alert detection live here
// so they can be tested without the network. The poller is in integrations.rs.

use serde::Serialize;
use serde_json::Value;

use crate::github::CiState;
use crate::settings::GitWatch;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct GitlabComment {
    pub id: String,
    pub author: String,
    pub at: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitlabMr {
    /// "group/proj!42"
    pub id: String,
    pub iid: i64,
    pub title: String,
    pub url: String,
    pub project: String,
    #[serde(default)]
    pub author: String,
    pub ci: CiState,
    pub head_sha: Option<String>,
    pub pipeline_url: Option<String>,
    /// REST `project_id`, used to fetch pipelines when GraphQL is unavailable.
    #[serde(skip_serializing, default)]
    pub project_id: Option<i64>,
    #[serde(skip_serializing, default)]
    pub comments: Vec<GitlabComment>,
    /// True once this poll actually has a note list (GraphQL or REST). A failed
    /// fetch stays false so the next success is a baseline, not a backlog alert.
    #[serde(skip_serializing, default)]
    pub notes_fetched: bool,
    #[serde(skip_serializing, default)]
    pub user_notes_count: Option<i64>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct GitlabPulse {
    pub login: String,
    pub mine: Vec<GitlabMr>,
    pub assigned: Vec<GitlabMr>,
    pub review: Vec<GitlabMr>,
    #[serde(rename = "fetchedAt")]
    pub fetched_at: u64,
}

/// Same shape as GitHubEvent so the island can share one notice card.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind")]
pub enum GitlabEvent {
    #[serde(rename = "ciFailed")]
    CiFailed {
        #[serde(rename = "prId")]
        pr_id: String,
        url: String,
        title: String,
    },
    #[serde(rename = "ciPassed")]
    CiPassed {
        #[serde(rename = "prId")]
        pr_id: String,
        url: String,
        title: String,
    },
    #[serde(rename = "newPr")]
    NewPr {
        #[serde(rename = "prId")]
        pr_id: String,
        url: String,
        title: String,
    },
    #[serde(rename = "comments")]
    Comments {
        #[serde(rename = "prId")]
        pr_id: String,
        url: String,
        title: String,
        count: usize,
    },
}

/// Minimal query: enterprise GitLab often rejects `notes(filter:)` or
/// `reviewRequestedMergeRequests`, which used to fail the whole pulse. Notes
/// are a separate query (`NOTES_QUERY`) so a notes failure cannot drop pipelines.
pub const GRAPHQL_QUERY: &str = r#"
fragment MrFields on MergeRequest {
  iid title webUrl
  author { username }
  project { fullPath }
  headPipeline { status webUrl sha }
}
query {
  currentUser {
    username
    authoredMergeRequests(state: opened, first: 20) {
      nodes { ...MrFields }
    }
    assignedMergeRequests(state: opened, first: 20) {
      nodes { ...MrFields }
    }
  }
}
"#;

/// Newest user notes, without `filter:` (enterprise GitLab rejects that argument
/// and used to fail the whole pulse). `last` asks for the recent end; if this
/// query fails, the poller falls back to REST `notes?sort=desc`.
pub const NOTES_QUERY: &str = r#"
query {
  currentUser {
    authoredMergeRequests(state: opened, first: 20) {
      nodes {
        iid
        project { fullPath }
        notes(last: 15) {
          nodes { id system createdAt author { username } }
        }
      }
    }
    assignedMergeRequests(state: opened, first: 20) {
      nodes {
        iid
        project { fullPath }
        notes(last: 15) {
          nodes { id system createdAt author { username } }
        }
      }
    }
  }
}
"#;

pub const REVIEW_NOTES_QUERY: &str = r#"
query {
  currentUser {
    reviewRequestedMergeRequests(state: opened, first: 20) {
      nodes {
        iid
        project { fullPath }
        notes(last: 15) {
          nodes { id system createdAt author { username } }
        }
      }
    }
  }
}
"#;

pub const GRAPHQL_REVIEW_QUERY: &str = r#"
query {
  currentUser {
    reviewRequestedMergeRequests(state: opened, first: 20) {
      nodes {
        iid title webUrl
        author { username }
        project { fullPath }
        headPipeline { status webUrl sha }
      }
    }
  }
}
"#;

fn str_at<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

fn nodes<'a>(parent: Option<&'a Value>) -> &'a [Value] {
    parent
        .and_then(|p| p.get("nodes"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

pub fn ci_from_gitlab(raw: Option<&str>) -> CiState {
    match raw.map(str::to_ascii_lowercase).as_deref() {
        Some("pending" | "running" | "created" | "waiting_for_resource" | "preparing" | "scheduled" | "manual") => {
            CiState::Pending
        }
        Some("success") => CiState::Success,
        Some("failed") => CiState::Failure,
        _ => CiState::Unknown,
    }
}

fn same_login(a: &str, b: &str) -> bool {
    !a.is_empty() && a.eq_ignore_ascii_case(b)
}

/// GraphQL ids are `gid://gitlab/Note/123`; REST ids are `123`. Compare the tail
/// so a fallback switch does not look like every note is new.
fn note_key(raw: &str) -> String {
    raw.rsplit('/').next().filter(|s| !s.is_empty()).unwrap_or(raw).to_string()
}

fn comments_of(node: &Value) -> Vec<GitlabComment> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for n in nodes(node.get("notes")) {
        if n.get("system").and_then(Value::as_bool).unwrap_or(false) {
            continue;
        }
        let Some(id) = str_at(n, "id") else { continue };
        let id = note_key(id);
        if !seen.insert(id.clone()) {
            continue;
        }
        out.push(GitlabComment {
            id,
            author: n.get("author").and_then(|a| str_at(a, "username")).unwrap_or("").to_string(),
            at: str_at(n, "createdAt").unwrap_or("").to_string(),
        });
    }
    out
}

/// REST `GET .../notes?sort=desc` payload: an array, not a GraphQL connection.
pub fn rest_comments(body: &Value) -> Vec<GitlabComment> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for n in body.as_array().into_iter().flatten() {
        if n.get("system").and_then(Value::as_bool).unwrap_or(false) {
            continue;
        }
        let id = n.get("id").and_then(|id| {
            id.as_i64().map(|n| n.to_string()).or_else(|| id.as_str().map(str::to_string))
        });
        let Some(id) = id else { continue };
        let id = note_key(&id);
        if !seen.insert(id.clone()) {
            continue;
        }
        out.push(GitlabComment {
            id,
            author: n.get("author").and_then(|a| str_at(a, "username")).unwrap_or("").to_string(),
            at: str_at(n, "created_at").or_else(|| str_at(n, "createdAt")).unwrap_or("").to_string(),
        });
    }
    out
}

fn parse_mr(node: &Value) -> Option<GitlabMr> {
    let iid = node.get("iid")?.as_i64()?;
    let title = str_at(node, "title").unwrap_or("").to_string();
    let url = str_at(node, "webUrl").or_else(|| str_at(node, "web_url")).unwrap_or("").to_string();
    let project = node
        .get("project")
        .and_then(|p| str_at(p, "fullPath").or_else(|| str_at(p, "path_with_namespace")))
        .or_else(|| node.get("references").and_then(|r| str_at(r, "full")))
        .unwrap_or("")
        .to_string();
    let pipeline = node.get("headPipeline").or_else(|| node.get("head_pipeline")).or_else(|| node.get("pipeline"));
    let ci = ci_from_gitlab(pipeline.and_then(|p| str_at(p, "status")));
    let head_sha = pipeline.and_then(|p| str_at(p, "sha")).map(str::to_string);
    let pipeline_url = pipeline
        .and_then(|p| str_at(p, "webUrl").or_else(|| str_at(p, "web_url")))
        .map(str::to_string);
    Some(GitlabMr {
        id: if project.is_empty() { format!("!{iid}") } else { format!("{project}!{iid}") },
        iid,
        title,
        url,
        project,
        author: node.get("author").and_then(|a| str_at(a, "username")).unwrap_or("").to_string(),
        ci,
        head_sha,
        pipeline_url,
        project_id: node.get("project_id").and_then(Value::as_i64),
        comments: comments_of(node),
        notes_fetched: node.get("notes").is_some(),
        user_notes_count: node
            .get("userNotesCount")
            .and_then(Value::as_i64)
            .or_else(|| node.get("user_notes_count").and_then(Value::as_i64)),
    })
}

/// Fill CI from a REST pipeline row (`GET .../merge_requests/:iid/pipelines`).
pub fn apply_pipeline_row(mr: &mut GitlabMr, row: &Value) {
    mr.ci = ci_from_gitlab(str_at(row, "status"));
    if let Some(sha) = str_at(row, "sha") {
        mr.head_sha = Some(sha.to_string());
    }
    if let Some(url) = str_at(row, "web_url").or_else(|| str_at(row, "webUrl")) {
        mr.pipeline_url = Some(url.to_string());
    }
}

fn collect_mrs(parent: Option<&Value>) -> Vec<GitlabMr> {
    let mut out: Vec<GitlabMr> = Vec::new();
    for node in nodes(parent) {
        let Some(mr) = parse_mr(node) else { continue };
        if out.iter().any(|p| p.id == mr.id) {
            continue;
        }
        out.push(mr);
    }
    out
}

fn new_foreign_comments(old: &GitlabMr, new: &GitlabMr, me: &str) -> usize {
    let seen: std::collections::HashSet<&str> = old.comments.iter().map(|c| c.id.as_str()).collect();
    new.comments
        .iter()
        .filter(|c| !seen.contains(c.id.as_str()) && !same_login(&c.author, me))
        .count()
}

fn jump_url(mr: &GitlabMr, pipeline: bool) -> String {
    if pipeline {
        mr.pipeline_url.clone().filter(|u| !u.is_empty()).unwrap_or_else(|| mr.url.clone())
    } else {
        mr.url.clone()
    }
}

impl GitlabPulse {
    /// GraphQL `data.currentUser` payload.
    pub fn parse(root: &Value, now: u64) -> Option<Self> {
        let user = root.get("data")?.get("currentUser")?.as_object()?;
        let login = user.get("username").and_then(Value::as_str).unwrap_or("").to_string();
        if login.is_empty() {
            return None;
        }
        Some(GitlabPulse {
            login,
            mine: collect_mrs(user.get("authoredMergeRequests")),
            assigned: collect_mrs(user.get("assignedMergeRequests")),
            review: collect_mrs(user.get("reviewRequestedMergeRequests")),
            fetched_at: now,
        })
    }

    pub fn merge_review(&mut self, root: &Value) {
        if let Some(user) = root.get("data").and_then(|d| d.get("currentUser")) {
            self.review = collect_mrs(user.get("reviewRequestedMergeRequests"));
        }
    }

    /// REST list payloads already shaped as arrays of MR JSON.
    pub fn from_rest(login: String, mine: Option<&Value>, assigned: Option<&Value>, review: Option<&Value>, now: u64) -> Self {
        fn list(v: Option<&Value>) -> Vec<GitlabMr> {
            v.and_then(Value::as_array)
                .map(|items| {
                    let mut out: Vec<GitlabMr> = Vec::new();
                    for node in items {
                        if let Some(mr) = parse_mr(node) {
                            if !out.iter().any(|p| p.id == mr.id) {
                                out.push(mr);
                            }
                        }
                    }
                    out
                })
                .unwrap_or_default()
        }
        GitlabPulse { login, mine: list(mine), assigned: list(assigned), review: list(review), fetched_at: now }
    }

    fn each_mr_mut(&mut self, mut f: impl FnMut(&mut GitlabMr)) {
        for mr in &mut self.mine {
            f(mr);
        }
        for mr in &mut self.assigned {
            f(mr);
        }
        for mr in &mut self.review {
            f(mr);
        }
    }

    pub fn set_notes(&mut self, id: &str, comments: Vec<GitlabComment>) {
        self.each_mr_mut(|mr| {
            if mr.id == id {
                mr.comments = comments.clone();
                mr.notes_fetched = true;
            }
        });
    }

    /// Copy notes from a dedicated notes query. Nodes without a `notes` key are
    /// left alone so a partial error does not wipe a list we already have.
    pub fn apply_notes_payload(&mut self, root: &Value) {
        let Some(user) = root.get("data").and_then(|d| d.get("currentUser")) else { return };
        for key in ["authoredMergeRequests", "assignedMergeRequests", "reviewRequestedMergeRequests"] {
            for node in nodes(user.get(key)) {
                if node.get("notes").is_none() {
                    continue;
                }
                let Some(parsed) = parse_mr(node) else { continue };
                self.set_notes(&parsed.id, parsed.comments);
            }
        }
    }

    /// Watched-or-not: every MR that still has no note list. The poller caps this.
    pub fn notes_pending(&self) -> Vec<(String, i64, String)> {
        let mut out = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for mr in self.mine.iter().chain(&self.assigned).chain(&self.review) {
            if mr.notes_fetched || mr.project.is_empty() {
                continue;
            }
            if seen.insert(mr.id.clone()) {
                out.push((mr.project.clone(), mr.iid, mr.id.clone()));
            }
        }
        out
    }

    /// A notes fetch failed: keep the previous list so the next success diffs
    /// against the last good snapshot instead of the empty one.
    pub fn seal_notes(&mut self, old: Option<&GitlabPulse>) {
        let Some(old) = old else { return };
        let prev: std::collections::HashMap<&str, &GitlabMr> =
            old.all_mrs().into_iter().map(|m| (m.id.as_str(), m)).collect();
        self.each_mr_mut(|mr| {
            if mr.notes_fetched {
                return;
            }
            let Some(old_mr) = prev.get(mr.id.as_str()) else { return };
            if old_mr.notes_fetched {
                mr.comments = old_mr.comments.clone();
                mr.notes_fetched = true;
            }
        });
    }

    fn watched(&self, watch: GitWatch) -> Vec<&GitlabMr> {
        let mut out = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for (on, mrs) in [
            (watch.created, self.mine.as_slice()),
            (watch.assigned, self.assigned.as_slice()),
            (watch.review, self.review.as_slice()),
        ] {
            if !on {
                continue;
            }
            for mr in mrs {
                if seen.insert(&mr.id) {
                    out.push(mr);
                }
            }
        }
        out
    }

    fn all_mrs(&self) -> Vec<&GitlabMr> {
        let mut out = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for mr in self.mine.iter().chain(&self.assigned).chain(&self.review) {
            if seen.insert(mr.id.clone()) {
                out.push(mr);
            }
        }
        out
    }

    pub fn has_pending(&self) -> bool {
        self.all_mrs().iter().any(|m| m.ci == CiState::Pending)
    }

    pub fn wants_fast_poll(&self) -> bool {
        self.has_pending() || !self.all_mrs().is_empty()
    }

    pub fn events(old: Option<&GitlabPulse>, new: &GitlabPulse, watch: GitWatch) -> Vec<GitlabEvent> {
        let Some(old) = old else { return Vec::new() };
        let mut out = Vec::new();
        let watched_new = new.watched(watch);
        let watched_old: std::collections::HashSet<&str> =
            old.watched(watch).into_iter().map(|p| p.id.as_str()).collect();
        let old_by_id: std::collections::HashMap<&str, &GitlabMr> =
            old.all_mrs().into_iter().map(|p| (p.id.as_str(), p)).collect();

        for mr in watched_new {
            let prev = old_by_id.get(mr.id.as_str()).copied();
            match prev {
                Some(prev) if prev.head_sha == mr.head_sha => {
                    if mr.ci == CiState::Failure && prev.ci != CiState::Failure {
                        out.push(GitlabEvent::CiFailed {
                            pr_id: mr.id.clone(),
                            url: jump_url(mr, true),
                            title: mr.title.clone(),
                        });
                    } else if mr.ci == CiState::Success && prev.ci == CiState::Pending {
                        out.push(GitlabEvent::CiPassed {
                            pr_id: mr.id.clone(),
                            url: jump_url(mr, true),
                            title: mr.title.clone(),
                        });
                    }
                }
                _ => match mr.ci {
                    CiState::Success => out.push(GitlabEvent::CiPassed {
                        pr_id: mr.id.clone(),
                        url: jump_url(mr, true),
                        title: mr.title.clone(),
                    }),
                    CiState::Failure => out.push(GitlabEvent::CiFailed {
                        pr_id: mr.id.clone(),
                        url: jump_url(mr, true),
                        title: mr.title.clone(),
                    }),
                    _ => {}
                },
            }
            if !watched_old.contains(mr.id.as_str()) && !same_login(&mr.author, &new.login) {
                out.push(GitlabEvent::NewPr {
                    pr_id: mr.id.clone(),
                    url: jump_url(mr, false),
                    title: mr.title.clone(),
                });
            }
            if let Some(prev) = prev {
                // Both sides must have actually loaded notes. The first successful
                // fetch after a failure is a baseline, not a popup for every old note.
                if !(prev.notes_fetched && mr.notes_fetched) {
                    continue;
                }
                let count = new_foreign_comments(prev, mr, &new.login);
                if count > 0 {
                    out.push(GitlabEvent::Comments {
                        pr_id: mr.id.clone(),
                        url: jump_url(mr, false),
                        title: mr.title.clone(),
                        count,
                    });
                }
            }
        }
        out
    }

    pub fn card_mrs(list: &[GitlabMr]) -> Vec<Value> {
        list.iter()
            .take(8)
            .map(|mr| {
                serde_json::json!({
                    "iid": mr.iid,
                    "title": mr.title,
                    "project": mr.project,
                    "url": mr.url,
                })
            })
            .collect()
    }

    pub fn card_pipelines(&self) -> (Vec<Value>, bool) {
        let mut rows = Vec::new();
        let mut running = false;
        let mut seen = std::collections::HashSet::new();
        for mr in self.all_mrs() {
            if mr.ci == CiState::Pending {
                running = true;
            }
            if mr.ci == CiState::Unknown {
                continue;
            }
            let key = mr.pipeline_url.clone().unwrap_or_else(|| mr.id.clone());
            if !seen.insert(key) {
                continue;
            }
            let status = match mr.ci {
                CiState::Pending => "running",
                CiState::Success => "success",
                CiState::Failure => "failed",
                CiState::Unknown => continue,
            };
            rows.push(serde_json::json!({
                "id": mr.iid,
                "status": status,
                "ref": "",
                "project": mr.project,
                "url": jump_url(mr, true),
            }));
            if rows.len() == 3 {
                break;
            }
        }
        (rows, running)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn mr(id: &str, author: &str, ci: CiState, sha: Option<&str>) -> GitlabMr {
        GitlabMr {
            id: id.into(),
            iid: 1,
            title: "T".into(),
            url: "https://gitlab.example.com/g/p/-/merge_requests/1".into(),
            project: "g/p".into(),
            author: author.into(),
            ci,
            head_sha: sha.map(str::to_string),
            pipeline_url: Some("https://gitlab.example.com/g/p/-/pipelines/9".into()),
            project_id: Some(1),
            comments: Vec::new(),
            notes_fetched: true,
            user_notes_count: None,
        }
    }

    fn empty() -> GitlabPulse {
        GitlabPulse { login: "me".into(), mine: vec![], assigned: vec![], review: vec![], fetched_at: 0 }
    }

    #[test]
    fn first_poll_is_silent() {
        let mut p = empty();
        p.assigned = vec![mr("g/p!1", "alice", CiState::Success, Some("a"))];
        assert!(GitlabPulse::events(None, &p, GitWatch::default()).is_empty());
    }

    #[test]
    fn own_new_mr_does_not_pop() {
        let old = empty();
        let mut new = empty();
        new.mine = vec![mr("g/p!2", "me", CiState::Pending, Some("a"))];
        assert!(GitlabPulse::events(Some(&old), &new, GitWatch::default()).is_empty());
    }

    #[test]
    fn assigned_mr_from_someone_else_pops_once() {
        let old = empty();
        let mut new = empty();
        new.assigned = vec![mr("g/p!3", "alice", CiState::Unknown, None)];
        assert_eq!(
            GitlabPulse::events(Some(&old), &new, GitWatch::default()),
            vec![GitlabEvent::NewPr {
                pr_id: "g/p!3".into(),
                url: "https://gitlab.example.com/g/p/-/merge_requests/1".into(),
                title: "T".into(),
            }]
        );
    }

    #[test]
    fn pipeline_success_and_failure() {
        let mut old = empty();
        old.mine = vec![mr("g/p!4", "me", CiState::Pending, Some("s"))];
        let mut new = old.clone();
        new.mine[0].ci = CiState::Success;
        assert_eq!(
            GitlabPulse::events(Some(&old), &new, GitWatch::default()),
            vec![GitlabEvent::CiPassed {
                pr_id: "g/p!4".into(),
                url: "https://gitlab.example.com/g/p/-/pipelines/9".into(),
                title: "T".into(),
            }]
        );
        new.mine[0].ci = CiState::Failure;
        new.mine[0].head_sha = Some("t".into());
        assert_eq!(
            GitlabPulse::events(Some(&old), &new, GitWatch::default()),
            vec![GitlabEvent::CiFailed {
                pr_id: "g/p!4".into(),
                url: "https://gitlab.example.com/g/p/-/pipelines/9".into(),
                title: "T".into(),
            }]
        );
    }

    #[test]
    fn comments_batch_and_skip_own() {
        let mut old_mr = mr("g/p!5", "me", CiState::Success, Some("s"));
        old_mr.comments = vec![GitlabComment { id: "1".into(), author: "bob".into(), at: "a".into() }];
        let mut new_mr = old_mr.clone();
        new_mr.comments.push(GitlabComment { id: "2".into(), author: "bob".into(), at: "b".into() });
        new_mr.comments.push(GitlabComment { id: "3".into(), author: "me".into(), at: "c".into() });
        let mut old = empty();
        old.mine = vec![old_mr];
        let mut new = empty();
        new.mine = vec![new_mr];
        assert_eq!(
            GitlabPulse::events(Some(&old), &new, GitWatch::default()),
            vec![GitlabEvent::Comments {
                pr_id: "g/p!5".into(),
                url: "https://gitlab.example.com/g/p/-/merge_requests/1".into(),
                title: "T".into(),
                count: 1,
            }]
        );
    }

    #[test]
    fn watch_off_drops_assigned() {
        let old = empty();
        let mut new = empty();
        new.assigned = vec![mr("g/p!6", "alice", CiState::Success, Some("x"))];
        let only_created = GitWatch { created: true, assigned: false, review: false };
        assert!(GitlabPulse::events(Some(&old), &new, only_created).is_empty());
    }

    #[test]
    fn parse_graphql() {
        let root = json!({
          "data": {
            "currentUser": {
              "username": "me",
              "authoredMergeRequests": { "nodes": [{
                "iid": 4,
                "title": "Fix",
                "webUrl": "https://gitlab.example.com/g/p/-/merge_requests/4",
                "author": { "username": "me" },
                "project": { "fullPath": "g/p" },
                "headPipeline": { "id": "gid://gitlab/Pipeline/9", "status": "SUCCESS", "webUrl": "https://gitlab.example.com/g/p/-/pipelines/9", "sha": "abc" },
                "notes": { "nodes": [
                  { "id": "n1", "author": { "username": "bob" }, "createdAt": "t", "system": false }
                ]}
              }]},
              "assignedMergeRequests": { "nodes": [] },
              "reviewRequestedMergeRequests": { "nodes": [] }
            }
          }
        });
        let p = GitlabPulse::parse(&root, 3).unwrap();
        assert_eq!(p.login, "me");
        assert_eq!(p.mine.len(), 1);
        assert_eq!(p.mine[0].id, "g/p!4");
        assert_eq!(p.mine[0].ci, CiState::Success);
        assert_eq!(p.mine[0].comments.len(), 1);
        assert_eq!(p.fetched_at, 3);
    }

    #[test]
    fn rest_list_without_pipeline_is_unknown_until_enriched() {
        let list = json!([{
            "iid": 14895,
            "title": "failing",
            "web_url": "https://code.cwoa.net/g/p/-/merge_requests/14895",
            "project_id": 77,
            "author": { "username": "me" },
            "references": { "full": "g/p!14895" }
        }]);
        let mut pulse = GitlabPulse::from_rest("me".into(), Some(&list), None, None, 1);
        assert_eq!(pulse.mine[0].ci, CiState::Unknown);
        assert_eq!(pulse.mine[0].project_id, Some(77));
        apply_pipeline_row(&mut pulse.mine[0], &json!({
            "status": "failed",
            "sha": "dead",
            "web_url": "https://code.cwoa.net/g/p/-/pipelines/9"
        }));
        assert_eq!(pulse.mine[0].ci, CiState::Failure);
        assert_eq!(pulse.mine[0].head_sha.as_deref(), Some("dead"));
    }

    #[test]
    fn notes_query_does_not_use_the_filter_argument() {
        assert!(NOTES_QUERY.contains("notes(last:"));
        assert!(!NOTES_QUERY.contains("filter:"));
        assert!(!GRAPHQL_QUERY.contains("notes("), "notes stay off the pipeline query");
    }

    #[test]
    fn rest_notes_skip_system_and_normalise_ids() {
        let notes = rest_comments(&json!([
            { "id": 9, "system": true, "author": { "username": "bot" }, "created_at": "a", "body": "changed the milestone" },
            { "id": 10, "system": false, "author": { "username": "bob" }, "created_at": "b", "body": "looks good" }
        ]));
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].id, "10");
        assert_eq!(notes[0].author, "bob");
    }

    #[test]
    fn first_notes_payload_does_not_replay_history() {
        let mut old_mr = mr("g/p!7", "me", CiState::Success, Some("s"));
        old_mr.notes_fetched = false;
        old_mr.comments.clear();
        let mut new_mr = old_mr.clone();
        new_mr.notes_fetched = true;
        new_mr.comments.push(GitlabComment { id: "2".into(), author: "bob".into(), at: "b".into() });
        let mut old = empty();
        old.mine = vec![old_mr];
        let mut new = empty();
        new.mine = vec![new_mr];
        assert!(GitlabPulse::events(Some(&old), &new, GitWatch::default()).is_empty());
    }

    #[test]
    fn apply_notes_then_a_new_one_alerts() {
        let mut pulse = empty();
        pulse.mine = vec![mr("g/p!4", "me", CiState::Success, Some("s"))];
        pulse.mine[0].notes_fetched = false;
        pulse.mine[0].comments.clear();
        let payload = json!({
          "data": { "currentUser": { "authoredMergeRequests": { "nodes": [{
            "iid": 4,
            "project": { "fullPath": "g/p" },
            "notes": { "nodes": [
              { "id": "gid://gitlab/Note/1", "system": false, "author": { "username": "bob" }, "createdAt": "a" },
              { "id": "gid://gitlab/Note/2", "system": true, "author": { "username": "bot" }, "createdAt": "b" }
            ]}
          }]}}}
        });
        pulse.apply_notes_payload(&payload);
        assert!(pulse.mine[0].notes_fetched);
        assert_eq!(pulse.mine[0].comments.len(), 1);
        assert_eq!(pulse.mine[0].comments[0].id, "1");
        assert!(pulse.notes_pending().is_empty());

        let mut next = pulse.clone();
        next.mine[0].comments.push(GitlabComment { id: "3".into(), author: "carol".into(), at: "c".into() });
        assert_eq!(
            GitlabPulse::events(Some(&pulse), &next, GitWatch::default())
                .iter()
                .filter(|e| matches!(e, GitlabEvent::Comments { .. }))
                .count(),
            1
        );
    }

    #[test]
    fn a_failed_fetch_keeps_the_previous_notes() {
        let mut old = empty();
        let mut old_mr = mr("g/p!8", "me", CiState::Success, Some("s"));
        old_mr.comments = vec![GitlabComment { id: "1".into(), author: "bob".into(), at: "a".into() }];
        old.mine = vec![old_mr];
        let mut new = empty();
        let mut fresh = mr("g/p!8", "me", CiState::Success, Some("s"));
        fresh.notes_fetched = false;
        fresh.comments.clear();
        new.mine = vec![fresh];
        new.seal_notes(Some(&old));
        assert!(new.mine[0].notes_fetched);
        assert_eq!(new.mine[0].comments.len(), 1);
        assert!(GitlabPulse::events(Some(&old), &new, GitWatch::default()).is_empty());
    }
}
