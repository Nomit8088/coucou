// Kingeye (CTeam DevOps) — the pure half of the poller, kept apart from the
// network so it can be tested without a token (integrations.rs::poll_kingeye).
//
// The public OpenAPI (service_open/issue/2.1.0/basic) is the only interface this
// card uses: it takes a filter array and answers newest-first. What it does NOT
// expose is a project field for the version, and `updateUser` is not filterable
// at all — so the version and the "last touched by me" halves are matched here,
// on the page the server returned.

use serde_json::{json, Value};

/// How many rows the card may carry. The counts stay exact either way.
pub const MAX_ITEMS: usize = 50;

/// Roles a work item can play in the card.
pub fn is_defect(classify: &str) -> bool {
    classify == "BUG"
}

pub fn is_requirement(classify: &str) -> bool {
    classify == "DEMAND"
}

/// The CTeam page for one work item: the two `tw…` screens the URLs use.
pub fn classify_path(classify: &str) -> Option<&'static str> {
    match classify {
        "BUG" => Some("twBug"),
        "DEMAND" => Some("twDemand"),
        _ => None,
    }
}

/// `https://<host>/devops/console/vteam/<project>/<twBug|twDemand>?vmode=table&id=<id>`.
///
/// Built from the configured origin, never from anything the response said: a
/// record cannot point the card at another host.
pub fn detail_url(origin: &str, project: &str, classify: &str, id: &str) -> String {
    let host = origin.trim_end_matches('/');
    let screen = classify_path(classify).unwrap_or("twBug");
    format!("{host}/devops/console/vteam/{project}/{screen}?vmode=table&id={id}")
}

/// True when `version` appears in `title` as a version of its own.
///
/// The titles look like `【4.5.16日志】…`, so the number is both preceded by a
/// bracket or a space and followed by something that is not a digit. Requiring
/// the character before to be neither a digit nor a dot is what stops "5.3"
/// from being found inside "4.5.3" or "15.3".
pub fn version_in_title(title: &str, version: &str) -> bool {
    if version.is_empty() {
        return false;
    }
    let mut from = 0usize;
    while let Some(rel) = title[from..].find(version) {
        let start = from + rel;
        let end = start + version.len();
        let after_ok = title[end..].chars().next().map(|c| !c.is_ascii_digit()).unwrap_or(true);
        let before_ok = title[..start]
            .chars()
            .next_back()
            .map(|c| !c.is_ascii_digit() && c != '.')
            .unwrap_or(true);
        if after_ok && before_ok {
            return true;
        }
        from = end;
    }
    false
}

/// An empty version list means "do not filter on the version".
pub fn title_matches_versions(title: &str, versions: &[String]) -> bool {
    versions.is_empty() || versions.iter().any(|v| version_in_title(title, v))
}

/// Matches either the version token in the title, or the record's own `version` field.
pub fn matches_versions(title: &str, record: &Value, versions: &[String]) -> bool {
    if versions.is_empty() {
        return true;
    }
    if versions.iter().any(|v| version_in_title(title, v)) {
        return true;
    }
    let ver = record.get("version").and_then(Value::as_str).unwrap_or("");
    if !ver.is_empty() && versions.iter().any(|v| v == ver || ver.contains(v.as_str())) {
        return true;
    }
    false
}

/// An empty state list means "keep every state"; otherwise the names must match
/// one the user picked ("已关闭" is what they untick).
pub fn state_kept(state_cn: &str, states: &[String]) -> bool {
    states.is_empty() || states.iter().any(|s| s == state_cn)
}

/// Whether this work item involves `login`.
///
/// The union the card promises: the items the login created, the one item
/// `assign_id` (the person id `assignId` is compared against) is responsible
/// for, and — when the user asked for it — whatever the login last touched.
/// `updateUser` is only ever the *last* editor, so "touched" is a best effort:
/// an item the login edited and someone else edited after no longer shows here.
pub fn is_mine(record: &Value, login: &str, assign_id: &str, include_touched: bool) -> bool {
    if record.get("_matched").and_then(Value::as_bool).unwrap_or(false) {
        return true;
    }
    let str_at = |key: &str| record.get(key).and_then(Value::as_str).unwrap_or("");
    if !login.is_empty() && str_at("createUser") == login {
        return true;
    }
    if !assign_id.is_empty() && str_at("assignId") == assign_id {
        return true;
    }
    include_touched && !login.is_empty() && str_at("updateUser") == login
}

/// The keys the API needs to find one project's work items of one kind.
/// If `projects` is empty, no `projectId` filter is added, searching across all projects.
pub fn query_filters(projects: &[String], classify: &str) -> Value {
    if projects.is_empty() {
        json!([
            { "name": "typeClassify", "value": [classify] }
        ])
    } else {
        json!([
            { "name": "projectId", "value": projects },
            { "name": "typeClassify", "value": [classify] },
        ])
    }
}

/// The card row for one record. Only fields the card shows are copied over.
pub fn card_item(record: &Value, origin: &str) -> Option<Value> {
    let id = record.get("id").and_then(Value::as_str).unwrap_or("");
    let project = record.get("projectId").and_then(Value::as_str).unwrap_or("");
    let classify = record.get("typeClassify").and_then(Value::as_str).unwrap_or("");
    if id.is_empty() || project.is_empty() {
        return None;
    }
    Some(json!({
        "id": id,
        "number": record.get("number").and_then(Value::as_str).unwrap_or(""),
        "title": record.get("title").and_then(Value::as_str).unwrap_or(""),
        "classify": classify,
        "state": record.get("stateCn").and_then(Value::as_str).unwrap_or(""),
        "priority": record.get("priorityCn").and_then(Value::as_str).unwrap_or(""),
        "createTime": record.get("createTime").and_then(Value::as_str).unwrap_or(""),
        "version": record.get("version").and_then(Value::as_str).unwrap_or(""),
        "url": detail_url(origin, project, classify, id),
    }))
}

/// Which of `records` the card should show, and how many of each kind there are.
///
/// Returns `(items, requirements, defects)`. The counts cover everything the
/// page held that passed the filters; `items` is capped at `MAX_ITEMS`.
pub fn select(
    records: &[Value],
    origin: &str,
    login: &str,
    assign_id: &str,
    include_touched: bool,
    versions: &[String],
    demand_states: &[String],
    bug_states: &[String],
) -> (Vec<Value>, usize, usize) {
    let mut items = Vec::new();
    let mut requirements = 0usize;
    let mut defects = 0usize;

    for record in records {
        let classify = record.get("typeClassify").and_then(Value::as_str).unwrap_or("");
        let defect = is_defect(classify);
        let requirement = is_requirement(classify);
        if !defect && !requirement {
            continue;
        }
        if !is_mine(record, login, assign_id, include_touched) {
            continue;
        }
        let title = record.get("title").and_then(Value::as_str).unwrap_or("");
        if !matches_versions(title, record, versions) {
            continue;
        }
        let state_cn = record.get("stateCn").and_then(Value::as_str).unwrap_or("");
        if defect {
            if !state_kept(state_cn, bug_states) {
                continue;
            }
            defects += 1;
        } else {
            if !state_kept(state_cn, demand_states) {
                continue;
            }
            requirements += 1;
        }
        if items.len() < MAX_ITEMS {
            if let Some(item) = card_item(record, origin) {
                items.push(item);
            }
        }
    }
    (items, requirements, defects)
}

/// The ids in `ids` that were not in `seen` before, updating `seen` in place.
///
/// The very first call fills the set and reports nothing, the way the Swift
/// pollers stay quiet on their first pass. `seen` is replaced rather than grown
/// once it gets large, so a long-running app cannot keep every id forever.
pub fn new_ids(
    seen: &mut std::collections::HashSet<String>,
    ids: &[String],
    seeded: &mut bool,
) -> Vec<String> {
    if !*seeded {
        *seeded = true;
        *seen = ids.iter().cloned().collect();
        return Vec::new();
    }
    let fresh: Vec<String> = ids.iter().filter(|id| !seen.contains(*id)).cloned().collect();
    if seen.len() > 2000 {
        *seen = ids.iter().cloned().collect();
    } else {
        for id in ids {
            seen.insert(id.clone());
        }
    }
    fresh
}

/// The Devops host every request goes to, and that every link stays on.
pub const DEFAULT_ORIGIN: &str = "https://devops.cwoa.net";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_version_is_found_where_the_titles_put_it() {
        assert!(version_in_title("【4.5.16日志】全局检索日志详情展示", "4.5.16"));
        assert!(version_in_title("【 5.3 告警】首页层级染色", "5.3"));
        assert!(version_in_title("5.3 进度同步会议", "5.3"));
    }

    #[test]
    fn a_version_is_not_found_inside_a_longer_number() {
        // "5.3" must not be read out of "4.5.3", nor out of "15.3".
        assert!(!version_in_title("4.5.3 修复", "5.3"));
        assert!(!version_in_title("15.3 修复", "5.3"));
        // Nor out of a four-part version that merely starts with it.
        assert!(!version_in_title("【4.5.16 告警】", "4.5.1"));
    }

    #[test]
    fn an_empty_version_list_keeps_every_title() {
        assert!(title_matches_versions("no version here", &[]));
        let only_53 = vec!["5.3".to_string()];
        assert!(!title_matches_versions("【4.5.16】x", &only_53));
        assert!(title_matches_versions("【5.3】x", &only_53));
    }

    #[test]
    fn a_state_is_kept_only_when_it_was_picked() {
        assert!(state_kept("已关闭", &[]));
        let open = vec!["新".to_string(), "开发中".to_string()];
        assert!(state_kept("开发中", &open));
        assert!(!state_kept("已关闭", &open));
    }

    #[test]
    fn mine_covers_created_assigned_and_touched() {
        let created = json!({ "createUser": "timon", "updateUser": "other", "assignId": "" });
        assert!(is_mine(&created, "timon", "", false));

        let assigned = json!({ "createUser": "other", "updateUser": "other", "assignId": "abc" });
        assert!(is_mine(&assigned, "timon", "abc", false));
        // Without the person id bound, nothing can be matched on it.
        assert!(!is_mine(&assigned, "timon", "", false));

        let touched = json!({ "createUser": "other", "updateUser": "timon", "assignId": "" });
        assert!(is_mine(&touched, "timon", "", true));
        assert!(!is_mine(&touched, "timon", "", false));

        let unrelated = json!({ "createUser": "other", "updateUser": "other", "assignId": "z" });
        assert!(!is_mine(&unrelated, "timon", "abc", true));
    }

    #[test]
    fn the_filters_ask_for_one_project_set_and_one_kind() {
        let projects = vec!["aiops".to_string(), "he".to_string()];
        assert_eq!(
            query_filters(&projects, "BUG"),
            json!([
                { "name": "projectId", "value": ["aiops", "he"] },
                { "name": "typeClassify", "value": ["BUG"] },
            ])
        );
    }

    #[test]
    fn a_link_is_built_from_the_configured_host() {
        let record = json!({
            "id": "af6aa8f6d5124125bdd5e631d3a7665f",
            "number": "p130_15369",
            "title": "【4.5.16日志】全局检索",
            "projectId": "aiops",
            "typeClassify": "BUG",
            "stateCn": "已关闭",
            "priorityCn": "中",
            "createTime": "2026-10-10 17:28:51",
        });
        let item = card_item(&record, "https://devops.cwoa.net").unwrap();
        assert_eq!(item["number"], json!("p130_15369"));
        assert_eq!(
            item["url"],
            json!("https://devops.cwoa.net/devops/console/vteam/aiops/twBug?vmode=table&id=af6aa8f6d5124125bdd5e631d3a7665f")
        );
    }

    #[test]
    fn a_demand_opens_the_demand_screen() {
        assert!(detail_url("https://h", "aiops", "DEMAND", "x").contains("/twDemand?"));
        assert!(detail_url("https://h", "aiops", "BUG", "x").contains("/twBug?"));
    }

    #[test]
    fn select_counts_everything_it_keeps_but_caps_the_rows() {
        let origin = "https://devops.cwoa.net";
        let mut records = Vec::new();
        for i in 0..20 {
            records.push(json!({
                "id": format!("id{i}"),
                "number": format!("p130_{i}"),
                "title": "【5.3告警】x",
                "projectId": "aiops",
                "typeClassify": "BUG",
                "stateCn": "开发中",
                "createUser": "timon",
                "updateUser": "timon",
                "assignId": "",
            }));
        }
        records.push(json!({
            "id": "req1", "number": "p130_1", "title": "【5.3】需求",
            "projectId": "aiops", "typeClassify": "DEMAND", "stateCn": "研发中",
            "createUser": "timon", "updateUser": "timon", "assignId": "",
        }));
        let (items, reqs, bugs) = select(&records, origin, "timon", "", true, &[], &[], &[]);
        assert_eq!(reqs, 1);
        assert_eq!(bugs, 20);
        assert_eq!(items.len(), 21);
    }

    #[test]
    fn select_applies_the_version_and_separate_state_filters() {
        let origin = "https://devops.cwoa.net";
        let records = vec![
            json!({ "id": "a", "number": "p1", "title": "【4.5.16日志】x", "projectId": "aiops",
                     "typeClassify": "BUG", "stateCn": "开发中", "createUser": "timon",
                     "updateUser": "timon", "assignId": "" }),
            json!({ "id": "b", "number": "p2", "title": "【4.5.16日志】y", "projectId": "aiops",
                     "typeClassify": "BUG", "stateCn": "已关闭", "createUser": "timon",
                     "updateUser": "timon", "assignId": "" }),
            json!({ "id": "c", "number": "p3", "title": "【5.3】z", "projectId": "aiops",
                     "typeClassify": "BUG", "stateCn": "开发中", "createUser": "timon",
                     "updateUser": "timon", "assignId": "" }),
            json!({ "id": "d", "number": "p4", "title": "【4.5.16日志】req", "projectId": "aiops",
                     "typeClassify": "DEMAND", "stateCn": "研发中", "createUser": "timon",
                     "updateUser": "timon", "assignId": "" }),
            json!({ "id": "e", "number": "p5", "title": "【4.5.16日志】req-done", "projectId": "aiops",
                     "typeClassify": "DEMAND", "stateCn": "测试通过", "createUser": "timon",
                     "updateUser": "timon", "assignId": "" }),
        ];
        let versions = vec!["4.5.16".to_string()];
        let demand_states = vec!["研发中".to_string()];
        let bug_states = vec!["开发中".to_string(), "新".to_string()];
        let (items, reqs, bugs) = select(
            &records, origin, "timon", "", true, &versions, &demand_states, &bug_states,
        );
        assert_eq!(reqs, 1);
        assert_eq!(bugs, 1);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["number"], json!("p1"));
        assert_eq!(items[1]["number"], json!("p4"));
    }

    #[test]
    fn the_first_pass_fills_the_seen_set_without_reporting() {
        let mut seen = std::collections::HashSet::new();
        let mut seeded = false;
        let ids = vec!["a".to_string(), "b".to_string()];
        assert!(new_ids(&mut seen, &ids, &mut seeded).is_empty());
        assert_eq!(new_ids(&mut seen, &ids, &mut seeded), Vec::<String>::new());
        let more = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        assert_eq!(new_ids(&mut seen, &more, &mut seeded), vec!["c".to_string()]);
    }

    #[test]
    fn matches_versions_checks_both_title_and_version_field() {
        let versions = vec!["4.7".to_string()];
        // 1. Matches title
        let rec1 = json!({ "title": "【4.7】需求", "version": "" });
        assert!(matches_versions("【4.7】需求", &rec1, &versions));

        // 2. Title has no version, but version field matches
        let rec2 = json!({ "title": "普通标题", "version": "4.7" });
        assert!(matches_versions("普通标题", &rec2, &versions));

        // 3. Neither matches
        let rec3 = json!({ "title": "普通标题", "version": "5.3" });
        assert!(!matches_versions("普通标题", &rec3, &versions));
    }

    #[test]
    fn query_filters_handles_empty_and_explicit_projects() {
        let with_proj = query_filters(&["aiops".to_string()], "BUG");
        assert_eq!(with_proj[0]["name"], "projectId");
        assert_eq!(with_proj[0]["value"], json!(["aiops"]));

        let empty_proj = query_filters(&[], "DEMAND");
        assert_eq!(empty_proj.as_array().unwrap().len(), 1);
        assert_eq!(empty_proj[0]["name"], "typeClassify");
        assert_eq!(empty_proj[0]["value"], json!(["DEMAND"]));
    }
}
