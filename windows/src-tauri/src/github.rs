// GitHub pulse and contribution calendar — the pure half of GithubPoller.swift,
// GitHubPulse.swift and GitHubActivity.swift. Parsing, alert detection and the
// staleness rule live here, away from the network, so they can be tested.
//
// The pollers that use them are in integrations.rs.

use serde::Serialize;
use serde_json::Value;

use crate::settings::GitWatch;

// ── CI and review states ──────────────────────────────────────────────────────

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CiState {
    Pending,
    Success,
    Failure,
    Unknown,
}

impl CiState {
    /// GitHub's `StatusState` (statusCheckRollup.state) → our four states.
    pub fn from_github(raw: Option<&str>) -> Self {
        match raw.map(str::to_ascii_uppercase).as_deref() {
            Some("PENDING") | Some("EXPECTED") => CiState::Pending,
            Some("SUCCESS") => CiState::Success,
            Some("ERROR") | Some("FAILURE") => CiState::Failure,
            _ => CiState::Unknown,
        }
    }
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReviewState {
    Approved,
    ChangesRequested,
    Pending,
    Unknown,
}

impl ReviewState {
    pub fn from_github(raw: Option<&str>) -> Self {
        match raw.map(str::to_ascii_uppercase).as_deref() {
            Some("APPROVED") => ReviewState::Approved,
            Some("CHANGES_REQUESTED") => ReviewState::ChangesRequested,
            Some("REVIEW_REQUIRED") => ReviewState::Pending,
            _ => ReviewState::Unknown,
        }
    }
}

// ── Pulse ─────────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPr {
    /// "owner/repo#number"
    pub id: String,
    pub title: String,
    pub url: String,
    pub repo: String,
    pub number: i64,
    pub is_draft: bool,
    pub ci: CiState,
    pub review: ReviewState,
    /// Oid of the PR's last commit, when GitHub returned it.
    pub head_sha: Option<String>,
    /// GitHub login of the author; empty when the payload omitted it.
    #[serde(default)]
    pub author: String,
    /// Conversation comments and non-empty reviews. Kept for event detection;
    /// the island card does not show them.
    #[serde(skip_serializing, default)]
    pub comments: Vec<GitHubComment>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct GitHubComment {
    pub id: String,
    pub author: String,
    pub at: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepoCi {
    pub repo: String,
    pub url: String,
    pub branch: String,
    pub ci: CiState,
    /// Oid of the default branch's head commit, when GitHub returned it.
    pub head_sha: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct GitHubPulse {
    pub login: String,
    #[serde(rename = "myPRs")]
    pub my_prs: Vec<GitHubPr>,
    #[serde(rename = "toReview")]
    pub to_review: Vec<GitHubPr>,
    #[serde(rename = "assigned")]
    pub assigned: Vec<GitHubPr>,
    #[serde(rename = "mainCI")]
    pub main_ci: Vec<GitHubRepoCi>,
    /// Unix time in milliseconds.
    #[serde(rename = "fetchedAt")]
    pub fetched_at: u64,
}

/// What a pulse poll can raise: the island turns these into a badge, a sound
/// and, for everything but a default-branch failure, a notice card with a link.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind")]
pub enum GitHubEvent {
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
    #[serde(rename = "mainFailed")]
    MainFailed { repo: String },
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

fn str_at<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

/// Pull request fields shared by "my PRs" and "to review"; None when a required
/// field is missing (that node is skipped, as on macOS).
fn pr_basics(node: &Value) -> Option<(String, String, String, String, i64, bool)> {
    let number = node.get("number")?.as_i64()?;
    let title = str_at(node, "title")?.to_string();
    let url = str_at(node, "url")?.to_string();
    let repo = node.get("repository").and_then(|r| str_at(r, "nameWithOwner"))?.to_string();
    let is_draft = node.get("isDraft").and_then(Value::as_bool).unwrap_or(false);
    Some((format!("{repo}#{number}"), title, url, repo, number, is_draft))
}

fn nodes<'a>(parent: Option<&'a Value>) -> &'a [Value] {
    parent
        .and_then(|p| p.get("nodes"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn comments_of(node: &Value) -> Vec<GitHubComment> {
    let mut out = Vec::new();
    for n in nodes(node.get("comments")) {
        let Some(id) = str_at(n, "id") else { continue };
        out.push(GitHubComment {
            id: id.to_string(),
            author: n.get("author").and_then(|a| str_at(a, "login")).unwrap_or("").to_string(),
            at: str_at(n, "createdAt").unwrap_or("").to_string(),
        });
    }
    for n in nodes(node.get("reviews")) {
        let body = str_at(n, "body").unwrap_or("");
        if body.trim().is_empty() {
            continue;
        }
        let Some(id) = str_at(n, "id") else { continue };
        out.push(GitHubComment {
            id: id.to_string(),
            author: n.get("author").and_then(|a| str_at(a, "login")).unwrap_or("").to_string(),
            at: str_at(n, "submittedAt").unwrap_or("").to_string(),
        });
    }
    out
}

fn parse_pr(node: &Value) -> Option<GitHubPr> {
    let (id, title, url, repo, number, is_draft) = pr_basics(node)?;
    let commit = node
        .get("commits")
        .and_then(|c| c.get("nodes"))
        .and_then(Value::as_array)
        .and_then(|a| a.last())
        .and_then(|n| n.get("commit"));
    let ci_raw = commit
        .and_then(|c| c.get("statusCheckRollup"))
        .and_then(|r| str_at(r, "state"));
    let head_sha = commit.and_then(|c| str_at(c, "oid")).map(str::to_string);
    Some(GitHubPr {
        id,
        title,
        url,
        repo,
        number,
        is_draft,
        ci: CiState::from_github(ci_raw),
        review: ReviewState::from_github(str_at(node, "reviewDecision")),
        head_sha,
        author: node.get("author").and_then(|a| str_at(a, "login")).unwrap_or("").to_string(),
        comments: comments_of(node),
    })
}

fn collect_prs(parent: Option<&Value>) -> Vec<GitHubPr> {
    let mut out: Vec<GitHubPr> = Vec::new();
    for node in nodes(parent) {
        let Some(pr) = parse_pr(node) else { continue };
        if out.iter().any(|p| p.id == pr.id) {
            continue;
        }
        out.push(pr);
    }
    out
}

fn same_login(a: &str, b: &str) -> bool {
    !a.is_empty() && a.eq_ignore_ascii_case(b)
}

fn new_foreign_comments(old: &GitHubPr, new: &GitHubPr, me: &str) -> usize {
    let seen: std::collections::HashSet<&str> = old.comments.iter().map(|c| c.id.as_str()).collect();
    new.comments
        .iter()
        .filter(|c| !seen.contains(c.id.as_str()) && !same_login(&c.author, me))
        .count()
}

fn ci_event(pr: &GitHubPr, passed: bool) -> GitHubEvent {
    if passed {
        GitHubEvent::CiPassed { pr_id: pr.id.clone(), url: pr.url.clone(), title: pr.title.clone() }
    } else {
        GitHubEvent::CiFailed { pr_id: pr.id.clone(), url: pr.url.clone(), title: pr.title.clone() }
    }
}

impl GitHubPulse {
    /// Parses the pulse GraphQL response. None when there is no `data.viewer`.
    pub fn parse(root: &Value, now_ms: u64) -> Option<Self> {
        let data = root.get("data")?.as_object()?;
        let viewer = data.get("viewer")?.as_object()?;
        let login = viewer.get("login").and_then(Value::as_str).unwrap_or("").to_string();

        let my_prs = collect_prs(viewer.get("pullRequests"));
        let mut to_review = collect_prs(data.get("reviewRequested"));
        for pr in &mut to_review {
            if pr.review == ReviewState::Unknown {
                pr.review = ReviewState::Pending;
            }
        }
        let assigned = collect_prs(data.get("assigned"));

        // Default-branch CI of the recently pushed repos, archived ones left out.
        let mut main_ci: Vec<GitHubRepoCi> = Vec::new();
        for node in nodes(viewer.get("repositories")) {
            if node.get("isArchived").and_then(Value::as_bool).unwrap_or(false) {
                continue;
            }
            let (Some(repo), Some(url)) = (str_at(node, "nameWithOwner"), str_at(node, "url")) else {
                continue;
            };
            let Some(branch_ref) = node.get("defaultBranchRef").filter(|b| b.is_object()) else {
                continue;
            };
            let Some(branch) = str_at(branch_ref, "name") else { continue };
            let target = branch_ref.get("target");
            let ci_raw = target
                .and_then(|t| t.get("statusCheckRollup"))
                .and_then(|r| str_at(r, "state"));
            let head_sha = target.and_then(|t| str_at(t, "oid")).map(str::to_string);
            main_ci.push(GitHubRepoCi {
                repo: repo.to_string(),
                url: url.to_string(),
                branch: branch.to_string(),
                ci: CiState::from_github(ci_raw),
                head_sha,
            });
        }

        Some(GitHubPulse { login, my_prs, to_review, assigned, main_ci, fetched_at: now_ms })
    }

    fn watched(&self, watch: GitWatch) -> Vec<&GitHubPr> {
        let mut out = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for (on, prs) in [
            (watch.created, self.my_prs.as_slice()),
            (watch.assigned, self.assigned.as_slice()),
            (watch.review, self.to_review.as_slice()),
        ] {
            if !on {
                continue;
            }
            for pr in prs {
                if seen.insert(&pr.id) {
                    out.push(pr);
                }
            }
        }
        out
    }

    fn all_prs(&self) -> Vec<&GitHubPr> {
        let mut out = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for pr in self.my_prs.iter().chain(&self.assigned).chain(&self.to_review) {
            if seen.insert(pr.id.clone()) {
                out.push(pr);
            }
        }
        out
    }

    /// True when a PR's CI or a default branch is still running — the next poll
    /// then comes after 60 s instead of 5 min.
    pub fn has_pending(&self) -> bool {
        self.all_prs().iter().any(|p| p.ci == CiState::Pending)
            || self.main_ci.iter().any(|r| r.ci == CiState::Pending)
    }

    /// Open associated PRs mean comments can land any minute: poll every 60 s.
    pub fn wants_fast_poll(&self) -> bool {
        self.has_pending() || !self.all_prs().is_empty()
    }

    /// Alerts between two polls. The first poll after launch (or after the token
    /// changed) has no `old` and stays silent.
    ///
    /// headSha rule, which catches CI runs faster than the poll interval:
    /// - same commit (or both unknown): plain state transitions;
    /// - new commit or new PR: alert at once if its CI is already done; if it is
    ///   still running, the next poll on the same commit will catch the result;
    /// - default branches only ever raise "failed", never "passed".
    ///
    /// New PRs the user opened themselves never pop up. Comments from the user
    /// are ignored; several new comments on one PR become a single event.
    pub fn events(old: Option<&GitHubPulse>, new: &GitHubPulse, watch: GitWatch) -> Vec<GitHubEvent> {
        let Some(old) = old else { return Vec::new() };
        let mut out = Vec::new();
        let watched_new = new.watched(watch);
        let watched_old: std::collections::HashSet<&str> =
            old.watched(watch).into_iter().map(|p| p.id.as_str()).collect();
        let old_by_id: std::collections::HashMap<&str, &GitHubPr> =
            old.all_prs().into_iter().map(|p| (p.id.as_str(), p)).collect();

        for pr in watched_new {
            let prev = old_by_id.get(pr.id.as_str()).copied();
            match prev {
                Some(prev) if prev.head_sha == pr.head_sha => {
                    if pr.ci == CiState::Failure && prev.ci != CiState::Failure {
                        out.push(ci_event(pr, false));
                    } else if pr.ci == CiState::Success && prev.ci == CiState::Pending {
                        out.push(ci_event(pr, true));
                    }
                }
                _ => match pr.ci {
                    CiState::Success => out.push(ci_event(pr, true)),
                    CiState::Failure => out.push(ci_event(pr, false)),
                    _ => {}
                },
            }
            if !watched_old.contains(pr.id.as_str()) && !same_login(&pr.author, &new.login) {
                out.push(GitHubEvent::NewPr {
                    pr_id: pr.id.clone(),
                    url: pr.url.clone(),
                    title: pr.title.clone(),
                });
            }
            if let Some(prev) = prev {
                let count = new_foreign_comments(prev, pr, &new.login);
                if count > 0 {
                    out.push(GitHubEvent::Comments {
                        pr_id: pr.id.clone(),
                        url: pr.url.clone(),
                        title: pr.title.clone(),
                        count,
                    });
                }
            }
        }

        for repo in &new.main_ci {
            let prev = old.main_ci.iter().find(|r| r.repo == repo.repo);
            let failed = match prev {
                Some(prev) if prev.head_sha == repo.head_sha => {
                    repo.ci == CiState::Failure && prev.ci != CiState::Failure
                }
                _ => repo.ci == CiState::Failure,
            };
            if failed {
                out.push(GitHubEvent::MainFailed { repo: repo.repo.clone() });
            }
        }

        out
    }
}

/// True when nothing was fetched yet or the last fetch is older than `max_age_secs`.
pub fn is_stale(fetched_at_ms: Option<u64>, now_ms: u64, max_age_secs: u64) -> bool {
    match fetched_at_ms {
        None => true,
        Some(t) => now_ms.saturating_sub(t) > max_age_secs * 1000,
    }
}

// ── Contribution calendar ─────────────────────────────────────────────────────

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ContributionDay {
    /// YYYY-MM-DD
    pub date: String,
    pub count: i64,
    /// 0…4, from NONE … FOURTH_QUARTILE.
    pub level: u8,
    /// 0 = Sunday … 6 = Saturday.
    pub weekday: u8,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct GitHubActivity {
    pub total: i64,
    /// Oldest week first; the last one is usually the current, incomplete week.
    pub weeks: Vec<Vec<ContributionDay>>,
    #[serde(rename = "fetchedAt")]
    pub fetched_at: u64,
}

fn contribution_level(raw: &str) -> u8 {
    match raw {
        "FIRST_QUARTILE" => 1,
        "SECOND_QUARTILE" => 2,
        "THIRD_QUARTILE" => 3,
        "FOURTH_QUARTILE" => 4,
        _ => 0,
    }
}

impl GitHubActivity {
    pub fn parse(root: &Value, now_ms: u64) -> Option<Self> {
        let calendar = root
            .get("data")?
            .get("viewer")?
            .get("contributionsCollection")?
            .get("contributionCalendar")?;
        let total = calendar.get("totalContributions")?.as_i64()?;
        let weeks_raw = calendar.get("weeks")?.as_array()?;

        let mut weeks = Vec::new();
        for week in weeks_raw {
            let Some(days_raw) = week.get("contributionDays").and_then(Value::as_array) else { continue };
            let days: Vec<ContributionDay> = days_raw
                .iter()
                .filter_map(|d| {
                    Some(ContributionDay {
                        date: str_at(d, "date")?.to_string(),
                        count: d.get("contributionCount")?.as_i64()?,
                        level: contribution_level(str_at(d, "contributionLevel")?),
                        weekday: u8::try_from(d.get("weekday")?.as_i64()?).ok()?,
                    })
                })
                .collect();
            if !days.is_empty() {
                weeks.push(days);
            }
        }
        Some(GitHubActivity { total, weeks, fetched_at: now_ms })
    }
}

// ── GraphQL ───────────────────────────────────────────────────────────────────

/// Open PRs I created, PRs assigned to me, PRs waiting for my review, plus
/// default-branch CI. Comments/reviews travel with each PR for the notice card.
pub const PULSE_QUERY: &str = r#"
fragment PrFields on PullRequest {
  number title url isDraft reviewDecision
  author { login }
  repository { nameWithOwner url }
  commits(last: 1) {
    nodes { commit { oid statusCheckRollup { state } } }
  }
  comments(last: 15) {
    nodes { id author { login } createdAt }
  }
  reviews(last: 15) {
    nodes { id author { login } submittedAt body }
  }
}
query {
  viewer {
    login
    pullRequests(states: OPEN, first: 20, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { ...PrFields }
    }
    repositories(first: 10, ownerAffiliations: [OWNER], orderBy: {field: PUSHED_AT, direction: DESC}) {
      nodes {
        nameWithOwner url isArchived
        defaultBranchRef {
          name
          target { ... on Commit { oid statusCheckRollup { state } } }
        }
      }
    }
  }
  reviewRequested: search(query: "is:pr is:open review-requested:@me archived:false", type: ISSUE, first: 20) {
    issueCount
    nodes { ... on PullRequest { ...PrFields } }
  }
  assigned: search(query: "is:pr is:open assignee:@me archived:false", type: ISSUE, first: 20) {
    issueCount
    nodes { ... on PullRequest { ...PrFields } }
  }
}
"#;

pub const ACTIVITY_QUERY: &str = r#"
query {
  viewer {
    login
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date contributionCount contributionLevel weekday
          }
        }
      }
    }
  }
}
"#;

/// Number of GraphQL errors in a response, for the log (never their text: it
/// can quote the query, not secrets, but there is no need for it).
pub fn graphql_error_count(root: &Value) -> usize {
    root.get("errors").and_then(Value::as_array).map(Vec::len).unwrap_or(0)
}

// ── Tests (GitHubPulseTests.swift, GitHubActivityTests.swift) ────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::GitWatch;
    use serde_json::json;

    fn valid_pulse() -> Value {
        json!({
          "data": {
            "viewer": {
              "login": "testuser",
              "pullRequests": { "nodes": [
                {
                  "number": 42, "title": "Add feature",
                  "url": "https://github.com/testuser/myrepo/pull/42",
                  "isDraft": false, "reviewDecision": "APPROVED",
                  "repository": {"nameWithOwner": "testuser/myrepo", "url": "https://github.com/testuser/myrepo"},
                  "commits": {"nodes": [{"commit": {"oid": "aaa", "statusCheckRollup": {"state": "SUCCESS"}}}]}
                },
                {
                  "number": 43, "title": "Fix bug",
                  "url": "https://github.com/testuser/myrepo/pull/43",
                  "isDraft": true, "reviewDecision": null,
                  "repository": {"nameWithOwner": "testuser/myrepo", "url": "https://github.com/testuser/myrepo"},
                  "commits": {"nodes": [{"commit": {"statusCheckRollup": null}}]}
                }
              ]},
              "repositories": { "nodes": [
                {
                  "nameWithOwner": "testuser/myrepo", "url": "https://github.com/testuser/myrepo",
                  "isArchived": false,
                  "defaultBranchRef": {"name": "main", "target": {"oid": "bbb", "statusCheckRollup": {"state": "PENDING"}}}
                },
                {
                  "nameWithOwner": "testuser/archived", "url": "https://github.com/testuser/archived",
                  "isArchived": true,
                  "defaultBranchRef": {"name": "main", "target": {"statusCheckRollup": {"state": "SUCCESS"}}}
                }
              ]}
            },
            "reviewRequested": {
              "issueCount": 1,
              "nodes": [{
                "number": 7, "title": "Review this",
                "url": "https://github.com/other/repo/pull/7",
                "isDraft": false, "author": {"login": "otheruser"},
                "repository": {"nameWithOwner": "other/repo", "url": "https://github.com/other/repo"}
              }]
            }
          }
        })
    }

    fn empty_pulse() -> GitHubPulse {
        let root = json!({
          "data": {
            "viewer": {"login": "testuser", "pullRequests": {"nodes": []}, "repositories": {"nodes": []}},
            "reviewRequested": {"issueCount": 0, "nodes": []}
          }
        });
        GitHubPulse::parse(&root, 0).unwrap()
    }

    fn pr(id: &str, ci: CiState, sha: Option<&str>) -> GitHubPr {
        GitHubPr {
            id: id.into(),
            title: "T".into(),
            url: String::new(),
            repo: id.split('#').next().unwrap().into(),
            number: 1,
            is_draft: false,
            ci,
            review: ReviewState::Unknown,
            head_sha: sha.map(str::to_string),
            author: "testuser".into(),
            comments: Vec::new(),
        }
    }

    fn repo(name: &str, ci: CiState, sha: Option<&str>) -> GitHubRepoCi {
        GitHubRepoCi { repo: name.into(), url: String::new(), branch: "main".into(), ci, head_sha: sha.map(str::to_string) }
    }

    #[test]
    fn parses_a_full_pulse() {
        let p = GitHubPulse::parse(&valid_pulse(), 5).unwrap();
        assert_eq!(p.login, "testuser");
        assert_eq!(p.my_prs.len(), 2);
        assert_eq!(p.my_prs[0].id, "testuser/myrepo#42");
        assert_eq!(p.my_prs[0].ci, CiState::Success);
        assert_eq!(p.my_prs[0].review, ReviewState::Approved);
        assert_eq!(p.my_prs[0].head_sha.as_deref(), Some("aaa"));
        assert_eq!(p.my_prs[1].ci, CiState::Unknown, "null rollup");
        assert_eq!(p.my_prs[1].review, ReviewState::Unknown, "null review");
        assert!(p.my_prs[1].is_draft);
        assert_eq!(p.main_ci.len(), 1, "archived repo filtered out");
        assert_eq!(p.main_ci[0].repo, "testuser/myrepo");
        assert_eq!(p.main_ci[0].ci, CiState::Pending);
        assert_eq!(p.main_ci[0].branch, "main");
        assert_eq!(p.main_ci[0].head_sha.as_deref(), Some("bbb"));
        assert_eq!(p.to_review.len(), 1);
        assert_eq!(p.to_review[0].id, "other/repo#7");
        assert_eq!(p.to_review[0].review, ReviewState::Pending);
        assert!(p.has_pending(), "default branch pending");
        assert_eq!(p.fetched_at, 5);
    }

    #[test]
    fn parses_an_empty_pulse() {
        let p = empty_pulse();
        assert!(p.my_prs.is_empty() && p.main_ci.is_empty() && p.to_review.is_empty());
        assert!(!p.has_pending());
    }

    #[test]
    fn rejects_bad_pulse_data() {
        assert!(GitHubPulse::parse(&json!("garbage"), 0).is_none());
        assert!(GitHubPulse::parse(&json!({}), 0).is_none());
        assert!(GitHubPulse::parse(&json!({"data": null}), 0).is_none());
    }

    #[test]
    fn keeps_the_first_of_duplicate_prs() {
        let root = json!({
          "data": {
            "viewer": {
              "login": "testuser",
              "pullRequests": {"nodes": [
                {"number": 42, "title": "Add feature", "url": "u", "isDraft": false, "reviewDecision": "APPROVED",
                 "repository": {"nameWithOwner": "testuser/myrepo"},
                 "commits": {"nodes": [{"commit": {"statusCheckRollup": {"state": "SUCCESS"}}}]}},
                {"number": 42, "title": "Duplicate entry", "url": "u", "isDraft": true, "reviewDecision": null,
                 "repository": {"nameWithOwner": "testuser/myrepo"},
                 "commits": {"nodes": [{"commit": {"statusCheckRollup": {"state": "FAILURE"}}}]}}
              ]},
              "repositories": {"nodes": []}
            },
            "reviewRequested": {"issueCount": 0, "nodes": []}
          }
        });
        let p = GitHubPulse::parse(&root, 0).unwrap();
        assert_eq!(p.my_prs.len(), 1);
        assert_eq!(p.my_prs[0].title, "Add feature");
        assert_eq!(p.my_prs[0].ci, CiState::Success);
    }

    #[test]
    fn maps_ci_states() {
        assert_eq!(CiState::from_github(None), CiState::Unknown);
        assert_eq!(CiState::from_github(Some("PENDING")), CiState::Pending);
        assert_eq!(CiState::from_github(Some("EXPECTED")), CiState::Pending);
        assert_eq!(CiState::from_github(Some("SUCCESS")), CiState::Success);
        assert_eq!(CiState::from_github(Some("FAILURE")), CiState::Failure);
        assert_eq!(CiState::from_github(Some("ERROR")), CiState::Failure);
        assert_eq!(CiState::from_github(Some("WAITING")), CiState::Unknown);
    }

    #[test]
    fn first_poll_is_silent() {
        let p = GitHubPulse::parse(&valid_pulse(), 0).unwrap();
        assert!(GitHubPulse::events(None, &p, GitWatch::default()).is_empty());
    }

    #[test]
    fn pending_to_success_passes() {
        let mut old = empty_pulse();
        old.my_prs = vec![pr("r/p#1", CiState::Pending, None)];
        let mut new = old.clone();
        new.my_prs[0].ci = CiState::Success;
        assert_eq!(GitHubPulse::events(Some(&old), &new, GitWatch::default()), vec![GitHubEvent::CiPassed { pr_id: "r/p#1".into(), url: String::new(), title: "T".into() }]);
    }

    #[test]
    fn success_to_failure_fails() {
        let mut old = empty_pulse();
        old.my_prs = vec![pr("r/p#2", CiState::Success, None)];
        let mut new = old.clone();
        new.my_prs[0].ci = CiState::Failure;
        assert_eq!(GitHubPulse::events(Some(&old), &new, GitWatch::default()), vec![GitHubEvent::CiFailed { pr_id: "r/p#2".into(), url: String::new(), title: "T".into() }]);
    }

    #[test]
    fn default_branch_breaking_alerts() {
        let mut old = empty_pulse();
        old.main_ci = vec![repo("a/b", CiState::Success, None)];
        let mut new = old.clone();
        new.main_ci[0].ci = CiState::Failure;
        assert_eq!(GitHubPulse::events(Some(&old), &new, GitWatch::default()), vec![GitHubEvent::MainFailed { repo: "a/b".into() }]);
    }

    #[test]
    fn default_branch_turning_green_is_quiet() {
        let mut old = empty_pulse();
        old.main_ci = vec![repo("a/b", CiState::Pending, Some("x"))];
        let mut new = old.clone();
        new.main_ci[0].ci = CiState::Success;
        assert!(GitHubPulse::events(Some(&old), &new, GitWatch::default()).is_empty());
        new.main_ci[0].head_sha = Some("y".into());
        assert!(GitHubPulse::events(Some(&old), &new, GitWatch::default()).is_empty());
    }

    #[test]
    fn new_review_request_alerts_once() {
        let mut review = pr("o/r#7", CiState::Unknown, None);
        review.review = ReviewState::Pending;
        review.author = "otheruser".into();
        let mut old = empty_pulse();
        let mut new = old.clone();
        new.to_review = vec![review.clone()];
        assert_eq!(
            GitHubPulse::events(Some(&old), &new, GitWatch::default()),
            vec![GitHubEvent::NewPr { pr_id: "o/r#7".into(), url: String::new(), title: "T".into() }]
        );
        old.to_review = vec![review];
        assert!(GitHubPulse::events(Some(&old), &new, GitWatch::default()).is_empty(), "already known");
    }

    #[test]
    fn duplicate_ids_in_old_fire_once() {
        let mut old = empty_pulse();
        let p = pr("r/p#1", CiState::Pending, None);
        old.my_prs = vec![p.clone(), p.clone()];
        let mut new = empty_pulse();
        let mut passed = p;
        passed.ci = CiState::Success;
        new.my_prs = vec![passed];
        let events = GitHubPulse::events(Some(&old), &new, GitWatch::default());
        assert_eq!(events.iter().filter(|e| matches!(e, GitHubEvent::CiPassed { .. })).count(), 1);
    }

    #[test]
    fn new_pr_already_green_passes() {
        let old = empty_pulse();
        let mut new = old.clone();
        new.my_prs = vec![pr("r/p#10", CiState::Success, Some("abc111"))];
        assert_eq!(GitHubPulse::events(Some(&old), &new, GitWatch::default()), vec![GitHubEvent::CiPassed { pr_id: "r/p#10".into(), url: String::new(), title: "T".into() }]);
    }

    #[test]
    fn new_pr_still_pending_is_quiet() {
        let old = empty_pulse();
        let mut new = old.clone();
        new.my_prs = vec![pr("r/p#11", CiState::Pending, Some("abc222"))];
        assert!(GitHubPulse::events(Some(&old), &new, GitWatch::default()).is_empty());
    }

    #[test]
    fn new_commit_already_red_fails() {
        let mut old = empty_pulse();
        old.my_prs = vec![pr("r/p#12", CiState::Success, Some("sha-old"))];
        let mut new = old.clone();
        new.my_prs[0].ci = CiState::Failure;
        new.my_prs[0].head_sha = Some("sha-new".into());
        assert_eq!(GitHubPulse::events(Some(&old), &new, GitWatch::default()), vec![GitHubEvent::CiFailed { pr_id: "r/p#12".into(), url: String::new(), title: "T".into() }]);
    }

    #[test]
    fn new_commit_already_green_passes_even_from_green() {
        // A fast CI ran entirely between two polls: success → (new sha) success.
        let mut old = empty_pulse();
        old.my_prs = vec![pr("r/p#14", CiState::Success, Some("one"))];
        let mut new = old.clone();
        new.my_prs[0].head_sha = Some("two".into());
        assert_eq!(GitHubPulse::events(Some(&old), &new, GitWatch::default()), vec![GitHubEvent::CiPassed { pr_id: "r/p#14".into(), url: String::new(), title: "T".into() }]);
    }

    #[test]
    fn same_sha_success_stays_quiet() {
        let mut old = empty_pulse();
        old.my_prs = vec![pr("r/p#13", CiState::Success, Some("same"))];
        let new = old.clone();
        assert!(GitHubPulse::events(Some(&old), &new, GitWatch::default()).is_empty());
    }

    #[test]
    fn new_commit_on_main_red_fails() {
        let mut old = empty_pulse();
        old.main_ci = vec![repo("a/b", CiState::Success, Some("sha-old"))];
        let mut new = old.clone();
        new.main_ci[0].ci = CiState::Failure;
        new.main_ci[0].head_sha = Some("sha-new".into());
        assert_eq!(GitHubPulse::events(Some(&old), &new, GitWatch::default()), vec![GitHubEvent::MainFailed { repo: "a/b".into() }]);
    }


    #[test]
    fn own_new_pr_does_not_pop_as_new() {
        let old = empty_pulse();
        let mut new = old.clone();
        new.my_prs = vec![pr("r/p#20", CiState::Pending, Some("x"))];
        assert!(GitHubPulse::events(Some(&old), &new, GitWatch::default()).is_empty());
    }

    #[test]
    fn assigned_pr_from_someone_else_pops_once() {
        let mut assigned = pr("o/r#9", CiState::Unknown, None);
        assigned.author = "alice".into();
        let mut old = empty_pulse();
        let mut new = old.clone();
        new.assigned = vec![assigned.clone()];
        assert_eq!(
            GitHubPulse::events(Some(&old), &new, GitWatch::default()),
            vec![GitHubEvent::NewPr { pr_id: "o/r#9".into(), url: String::new(), title: "T".into() }]
        );
        old.assigned = vec![assigned];
        assert!(GitHubPulse::events(Some(&old), &new, GitWatch::default()).is_empty());
    }

    #[test]
    fn watch_filters_drop_unselected_lists() {
        let mut assigned = pr("o/r#9", CiState::Success, Some("x"));
        assigned.author = "alice".into();
        let old = empty_pulse();
        let mut new = old.clone();
        new.assigned = vec![assigned];
        let only_created = GitWatch { created: true, assigned: false, review: false };
        assert!(GitHubPulse::events(Some(&old), &new, only_created).is_empty());
    }

    #[test]
    fn several_new_comments_on_one_pr_are_one_event() {
        let mut old_pr = pr("r/p#3", CiState::Success, Some("s"));
        old_pr.comments = vec![GitHubComment { id: "c1".into(), author: "bob".into(), at: "1".into() }];
        let mut new_pr = old_pr.clone();
        new_pr.comments.push(GitHubComment { id: "c2".into(), author: "bob".into(), at: "2".into() });
        new_pr.comments.push(GitHubComment { id: "c3".into(), author: "carol".into(), at: "3".into() });
        new_pr.comments.push(GitHubComment { id: "c4".into(), author: "testuser".into(), at: "4".into() });
        let mut old = empty_pulse();
        old.my_prs = vec![old_pr];
        let mut new = old.clone();
        new.my_prs = vec![new_pr];
        assert_eq!(
            GitHubPulse::events(Some(&old), &new, GitWatch::default()),
            vec![GitHubEvent::Comments { pr_id: "r/p#3".into(), url: String::new(), title: "T".into(), count: 2 }]
        );
    }

    #[test]
    fn own_comments_are_silent() {
        let old_pr = pr("r/p#4", CiState::Success, Some("s"));
        let mut new_pr = old_pr.clone();
        new_pr.comments.push(GitHubComment { id: "mine".into(), author: "testuser".into(), at: "1".into() });
        let mut old = empty_pulse();
        old.my_prs = vec![old_pr];
        let mut new = old.clone();
        new.my_prs = vec![new_pr];
        assert!(GitHubPulse::events(Some(&old), &new, GitWatch::default()).is_empty());
    }

    #[test]
    fn staleness() {
        let now = 1_000_000;
        assert!(is_stale(None, now, 60));
        assert!(!is_stale(Some(now), now, 60));
        assert!(!is_stale(Some(now - 60_000), now, 60));
        assert!(is_stale(Some(now - 61_000), now, 60));
        assert!(!is_stale(Some(now + 5_000), now, 60), "clock skew is not stale");
    }

    #[test]
    fn events_serialise_for_the_island() {
        let v = serde_json::to_value(GitHubEvent::CiFailed { pr_id: "a/b#1".into(), url: String::new(), title: "T".into() }).unwrap();
        assert_eq!(v, json!({"kind": "ciFailed", "prId": "a/b#1", "url": "", "title": "T"}));
        let v = serde_json::to_value(GitHubEvent::MainFailed { repo: "a/b".into() }).unwrap();
        assert_eq!(v, json!({"kind": "mainFailed", "repo": "a/b"}));
        let p = serde_json::to_value(GitHubPulse::parse(&valid_pulse(), 7).unwrap()).unwrap();
        assert!(p.get("myPRs").is_some() && p.get("toReview").is_some() && p.get("mainCI").is_some());
        assert_eq!(p["myPRs"][0]["isDraft"], json!(false));
        assert_eq!(p["myPRs"][0]["headSha"], json!("aaa"));
        assert_eq!(p["myPRs"][0]["ci"], json!("success"));
        assert_eq!(p["myPRs"][0]["review"], json!("approved"));
        assert_eq!(p["fetchedAt"], json!(7));
    }

    // ── Activity ──────────────────────────────────────────────────────────────

    fn day(date: &str, count: i64, level: &str, weekday: i64) -> Value {
        json!({"date": date, "contributionCount": count, "contributionLevel": level, "weekday": weekday})
    }

    fn valid_activity() -> Value {
        json!({
          "data": { "viewer": { "login": "testuser", "contributionsCollection": { "contributionCalendar": {
            "totalContributions": 42,
            "weeks": [
              {"contributionDays": [
                day("2026-01-05", 0, "NONE", 0),
                day("2026-01-06", 1, "FIRST_QUARTILE", 1),
                day("2026-01-07", 4, "SECOND_QUARTILE", 2),
                day("2026-01-08", 8, "THIRD_QUARTILE", 3),
                day("2026-01-09", 12, "FOURTH_QUARTILE", 4),
                day("2026-01-10", 2, "FIRST_QUARTILE", 5),
                day("2026-01-11", 0, "NONE", 6)
              ]},
              {"contributionDays": [
                day("2026-01-12", 5, "SECOND_QUARTILE", 0),
                day("2026-01-13", 10, "THIRD_QUARTILE", 1)
              ]}
            ]
          }}}}
        })
    }

    #[test]
    fn parses_the_contribution_calendar() {
        let a = GitHubActivity::parse(&valid_activity(), 3).unwrap();
        assert_eq!(a.total, 42);
        assert_eq!(a.weeks.len(), 2);
        assert_eq!(a.weeks[0].len(), 7);
        assert_eq!(a.weeks[1].len(), 2, "incomplete current week");
        let levels: Vec<u8> = a.weeks[0][..5].iter().map(|d| d.level).collect();
        assert_eq!(levels, vec![0, 1, 2, 3, 4]);
        assert_eq!(a.weeks[0][0].date, "2026-01-05");
        assert_eq!(a.weeks[0][0].count, 0);
        assert_eq!(a.weeks[0][0].weekday, 0);
        assert_eq!(a.weeks[1][1].date, "2026-01-13");
        assert_eq!(a.weeks[1][1].count, 10);
        assert_eq!(a.fetched_at, 3);
    }

    #[test]
    fn unknown_contribution_level_is_zero() {
        let root = json!({"data": {"viewer": {"contributionsCollection": {"contributionCalendar": {
            "totalContributions": 1,
            "weeks": [{"contributionDays": [day("2026-03-01", 1, "EXTRA_SPECIAL", 0)]}]
        }}}}});
        assert_eq!(GitHubActivity::parse(&root, 0).unwrap().weeks[0][0].level, 0);
    }

    #[test]
    fn rejects_bad_activity_data() {
        assert!(GitHubActivity::parse(&json!("garbage"), 0).is_none());
        assert!(GitHubActivity::parse(&json!({}), 0).is_none());
    }

    #[test]
    fn counts_graphql_errors() {
        assert_eq!(graphql_error_count(&json!({"data": {}})), 0);
        assert_eq!(graphql_error_count(&json!({"errors": [{}, {}]})), 2);
    }
}
