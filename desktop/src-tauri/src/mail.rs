// QQ Mail — the mailbox pill, over IMAP.
//
// The only way to read a QQ mailbox without a browser session is IMAP, and QQ's
// help is explicit about it: third-party clients sign in with the account's full
// address and the 16-character authorisation code from
// https://help.mail.qq.com/detail/0/1087, never the account password.
//
// Read-only by construction: CAPABILITY, (ID), LOGIN, SELECT INBOX, UID SEARCH
// UNSEEN and one UID FETCH of the newest unseen headers — no message body, no
// flags written, nothing sent. One connection per poll, closed right after.
//
// The TLS stack is the one reqwest already pulls in (rustls with the ring
// provider, and webpki-roots), so this adds no new crate to the build.

use std::sync::{Arc, OnceLock};
use std::time::Duration;

use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_rustls::client::TlsStream;
use tokio_rustls::rustls::{self, ClientConfig, RootCertStore};
use tokio_rustls::TlsConnector;

/// The mailbox QQ Mail's IMAP service answers on.
const HOST: &str = "imap.qq.com";
const PORT: u16 = 993;
/// Nothing in one exchange holds the poller up for longer.
const TIMEOUT: Duration = Duration::from_secs(10);
/// How many of the newest unseen messages the card gets.
const MAX_MESSAGES: usize = 5;
/// A headers-only response is far smaller; a bigger one is refused, not read.
const MAX_LITERAL: usize = 64 * 1024;

// ── What the card receives ────────────────────────────────────────────────────

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub uid: u32,
    /// The display name when the message carries one, its address otherwise.
    pub from: String,
    pub subject: String,
    /// The raw `Date:` header, right as RFC 5322 spells it (the page formats it).
    pub date: String,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Mailbox {
    /// Messages flagged unseen in INBOX.
    pub unread: usize,
    /// The newest of them, oldest first, so the last one is the newest arrival.
    pub messages: Vec<Message>,
}

/// A failure the card can say in one line.
#[derive(Debug)]
pub enum Error {
    /// The server refused the address or the authorisation code.
    Auth,
    /// Anything else: no connection, a protocol surprise.
    Other(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Auth => write!(f, "the mailbox refused the sign-in"),
            Error::Other(why) => write!(f, "{why}"),
        }
    }
}

// ── The exchange ──────────────────────────────────────────────────────────────

/// Reads INBOX: how many messages are unseen, and the headers of the newest few.
pub async fn fetch(address: &str, code: &str) -> Result<Mailbox, Error> {
    let mut imap = Imap::new(connect().await.map_err(Error::Other)?);

    let greeting = imap.read_line().await.map_err(Error::Other)?;
    if !greeting.starts_with("* OK") && !greeting.starts_with("* PREAUTH") {
        return Err(Error::Other(format!("IMAP: {greeting}")));
    }

    // Tencent's mail (QQ, 163) wants a client that identifies itself before it
    // signs in, and other servers do not know the command — so it goes out only
    // when the server advertises it, and its answer is never required.
    let capability = imap.command("CAPABILITY").await.map_err(Error::Other)?;
    if has_capability(&capability, "ID") {
        let _ = imap
            .command(&format!("ID (\"name\" \"Coucou\" \"version\" \"{}\")", env!("CARGO_PKG_VERSION")))
            .await;
    }

    let login = imap
        .command(&format!("LOGIN {} {}", quote(address), quote(code)))
        .await
        .map_err(Error::Other)?;
    if !login.ok {
        return Err(Error::Auth);
    }

    let selected = imap.command("SELECT INBOX").await.map_err(Error::Other)?;
    if !selected.ok {
        return Err(Error::Other(format!("IMAP: {}", selected.status)));
    }

    let search = imap.command("UID SEARCH UNSEEN").await.map_err(Error::Other)?;
    let unseen = search.uids();

    let newest: Vec<u32> = unseen.iter().rev().take(MAX_MESSAGES).rev().copied().collect();
    let messages = if newest.is_empty() {
        Vec::new()
    } else {
        let list = newest.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
        let fetched = imap
            .command(&format!("UID FETCH {list} (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])"))
            .await
            .map_err(Error::Other)?;
        fetched.messages()
    };

    let _ = imap.command("LOGOUT").await;
    Ok(Mailbox { unread: unseen.len(), messages })
}

/// An IMAP string literal: the code goes in as it is, quoted.
fn quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Whether the CAPABILITY answer lists this capability (RFC 3501, already uppercase).
fn has_capability(reply: &Reply, name: &str) -> bool {
    reply.responses.iter().any(|r| {
        r.text
            .strip_prefix("* CAPABILITY")
            .map(|list| list.split_whitespace().any(|word| word.eq_ignore_ascii_case(name)))
            .unwrap_or(false)
    })
}

// ── TLS ───────────────────────────────────────────────────────────────────────

/// One configuration for the process: the roots and the provider never change.
fn tls_config() -> Arc<ClientConfig> {
    static CONFIG: OnceLock<Arc<ClientConfig>> = OnceLock::new();
    CONFIG
        .get_or_init(|| {
            let mut roots = RootCertStore::empty();
            roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
            // reqwest's rustls already builds the ring provider, so the whole
            // TLS stack is one the app has compiled anyway.
            let provider = Arc::new(rustls::crypto::ring::default_provider());
            let config = ClientConfig::builder_with_provider(provider)
                .with_safe_default_protocol_versions()
                .expect("ring answers the default protocol versions")
                .with_root_certificates(roots)
                .with_no_client_auth();
            Arc::new(config)
        })
        .clone()
}

async fn connect() -> Result<TlsStream<TcpStream>, String> {
    let tcp = tokio::time::timeout(TIMEOUT, TcpStream::connect((HOST, PORT)))
        .await
        .map_err(|_| "connection timed out".to_string())?
        .map_err(|e| e.to_string())?;
    let name = rustls::pki_types::ServerName::try_from(HOST).map_err(|e| e.to_string())?;
    TlsConnector::from(tls_config())
        .connect(name, tcp)
        .await
        .map_err(|e| e.to_string())
}

// ── The line protocol ─────────────────────────────────────────────────────────

/// One untagged line of an answer, with the literals that followed it.
#[derive(Debug, PartialEq)]
struct Response {
    text: String,
    literals: Vec<Vec<u8>>,
}

impl Response {
    fn new(text: String) -> Self {
        Response { text, literals: Vec::new() }
    }
}

/// A whole tagged answer.
#[derive(Debug, PartialEq)]
struct Reply {
    /// The tagged line ended in OK.
    ok: bool,
    /// The tagged line itself, for the error when it did not.
    status: String,
    responses: Vec<Response>,
}

impl Reply {
    /// The unique ids of a `UID SEARCH` answer.
    fn uids(&self) -> Vec<u32> {
        self.responses
            .iter()
            .find_map(|r| r.text.strip_prefix("* SEARCH"))
            .map(|list| list.split_whitespace().filter_map(|word| word.parse().ok()).collect())
            .unwrap_or_default()
    }

    /// The messages of a `UID FETCH … (BODY.PEEK[HEADER.FIELDS …])` answer.
    fn messages(&self) -> Vec<Message> {
        self.responses
            .iter()
            .filter_map(|r| {
                let uid = uid_in(&r.text)?;
                let raw = String::from_utf8_lossy(r.literals.first()?);
                let headers = parse_headers(&raw);
                Some(Message { uid, from: headers.from, subject: headers.subject, date: headers.date })
            })
            .collect()
    }
}

struct Imap {
    stream: TlsStream<TcpStream>,
    /// Bytes read from the socket and not consumed yet.
    buf: Vec<u8>,
    tag: u32,
}

impl Imap {
    fn new(stream: TlsStream<TcpStream>) -> Self {
        Imap { stream, buf: Vec::new(), tag: 0 }
    }

    /// One CRLF-terminated line, without its ending. A literal's bytes never come
    /// through here: `command` reads those exactly.
    async fn read_line(&mut self) -> Result<String, String> {
        loop {
            if let Some(end) = self.buf.iter().position(|&b| b == b'\n') {
                let mut line: Vec<u8> = self.buf.drain(..=end).collect();
                line.pop(); // \n
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                return Ok(String::from_utf8_lossy(&line).into_owned());
            }
            self.fill().await?;
        }
    }

    /// Exactly `n` bytes: an IMAP literal, which may hold anything at all.
    async fn read_bytes(&mut self, n: usize) -> Result<Vec<u8>, String> {
        while self.buf.len() < n {
            self.fill().await?;
        }
        Ok(self.buf.drain(..n).collect())
    }

    async fn fill(&mut self) -> Result<(), String> {
        let mut chunk = [0u8; 8192];
        let read = tokio::time::timeout(TIMEOUT, self.stream.read(&mut chunk))
            .await
            .map_err(|_| "the server stopped answering".to_string())?
            .map_err(|e| e.to_string())?;
        if read == 0 {
            return Err("the server closed the connection".to_string());
        }
        self.buf.extend_from_slice(&chunk[..read]);
        Ok(())
    }

    /// Sends one tagged command and reads its whole answer.
    async fn command(&mut self, command: &str) -> Result<Reply, String> {
        self.tag += 1;
        let tag = format!("c{}", self.tag);
        let wire = format!("{tag} {command}\r\n");
        tokio::time::timeout(TIMEOUT, self.stream.write_all(wire.as_bytes()))
            .await
            .map_err(|_| "the server stopped answering".to_string())?
            .map_err(|e| e.to_string())?;
        self.stream.flush().await.map_err(|e| e.to_string())?;

        let mut responses = Vec::new();
        loop {
            let mut text = self.read_line().await?;
            let mut literals = Vec::new();
            // "… {123}" means 123 raw bytes follow, then the rest of the line.
            while let Some(size) = literal_len(&text) {
                if size > MAX_LITERAL {
                    return Err(format!("a {size}-byte answer is too big"));
                }
                literals.push(self.read_bytes(size).await?);
                text.push_str(&self.read_line().await?);
            }
            if text.starts_with(&tag) {
                let rest = text[tag.len()..].trim_start();
                return Ok(Reply { ok: rest.starts_with("OK"), status: text, responses });
            }
            let mut response = Response::new(text);
            response.literals = literals;
            responses.push(response);
        }
    }
}

/// The size an `{n}` at the end of a line announces.
fn literal_len(line: &str) -> Option<usize> {
    if !line.ends_with('}') {
        return None;
    }
    // "~{n}" is the non-synchronising form; either way n bytes follow.
    let open = line.rfind('{')?;
    line[open + 1..line.len() - 1].parse().ok()
}

/// The `UID` of a FETCH response line.
fn uid_in(line: &str) -> Option<u32> {
    let at = line.find("UID ")?;
    let digits: String = line[at + 4..].chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

// ── Headers ───────────────────────────────────────────────────────────────────

struct Headers {
    from: String,
    subject: String,
    date: String,
}

/// The three headers we asked for, unfolded.
fn parse_headers(raw: &str) -> Headers {
    let mut fields: Vec<(String, String)> = Vec::new();
    for line in raw.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.is_empty() {
            break;
        }
        if line.starts_with(' ') || line.starts_with('\t') {
            // A folded continuation belongs to the header above it.
            if let Some(last) = fields.last_mut() {
                last.1.push(' ');
                last.1.push_str(line.trim());
            }
            continue;
        }
        if let Some((name, value)) = line.split_once(':') {
            fields.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
        }
    }
    let get = |name: &str| {
        fields
            .iter()
            .find(|(field, _)| field == name)
            .map(|(_, value)| value.clone())
            .unwrap_or_default()
    };
    Headers {
        from: sender_name(&decode_encoded_words(&get("from"))),
        subject: decode_encoded_words(&get("subject")),
        date: get("date"),
    }
}

/// "Jane Doe <jane@example.com>" → "Jane Doe"; a bare address stays as it is.
fn sender_name(raw: &str) -> String {
    let raw = raw.trim();
    match (raw.rfind('<'), raw.rfind('>')) {
        (Some(open), Some(close)) if close > open => {
            let name = raw[..open].trim().trim_matches('"').trim();
            if name.is_empty() {
                raw[open + 1..close].trim().to_string()
            } else {
                name.to_string()
            }
        }
        _ => raw.to_string(),
    }
}

/// RFC 2047 encoded words: `=?UTF-8?B?…?=` and `=?GBK?Q?…?=`, in any order,
/// with the whitespace between two of them dropped.
fn decode_encoded_words(raw: &str) -> String {
    let mut out = String::new();
    let mut rest = raw;
    let mut after_word = false;
    while let Some(start) = rest.find("=?") {
        let before = &rest[..start];
        // Whitespace that only separates two encoded words is not text.
        if !(after_word && before.trim().is_empty()) {
            out.push_str(before);
        }
        let tail = &rest[start + 2..];
        let Some(end) = tail.find("?=") else {
            out.push_str(&rest[start..]);
            return out;
        };
        match decode_word(&tail[..end]) {
            Some(text) => {
                out.push_str(&text);
                after_word = true;
            }
            None => {
                // A charset this build cannot read (GBK, Big5…): the word stays
                // as it arrived rather than becoming mojibake.
                out.push_str(&rest[start..start + 2 + end + 2]);
                after_word = false;
            }
        }
        rest = &tail[end + 2..];
    }
    out.push_str(rest);
    out
}

/// `charset?encoding?data`, the inside of an encoded word.
fn decode_word(token: &str) -> Option<String> {
    let mut parts = token.splitn(3, '?');
    let charset = parts.next()?.trim().to_ascii_lowercase();
    let encoding = parts.next()?.trim().to_ascii_uppercase();
    let data = parts.next()?;
    let bytes = match encoding.as_str() {
        "B" => crate::recap::decode_base64(data)?,
        "Q" => q_decode(data),
        _ => return None,
    };
    decode_charset(&charset, &bytes)
}

/// The `Q` encoding: `_` is a space, `=XX` one byte.
fn q_decode(data: &str) -> Vec<u8> {
    let bytes = data.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'_' => {
                out.push(b' ');
                i += 1;
            }
            b'=' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok());
                match hex {
                    Some(byte) => {
                        out.push(byte);
                        i += 3;
                    }
                    None => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    out
}

fn decode_charset(charset: &str, bytes: &[u8]) -> Option<String> {
    match charset {
        "utf-8" | "utf8" | "us-ascii" | "ascii" => Some(String::from_utf8_lossy(bytes).into_owned()),
        // Single-byte Western sets: every byte is a character of its own.
        "iso-8859-1" | "iso8859-1" | "latin1" | "windows-1252" | "cp1252" => {
            Some(bytes.iter().map(|&b| b as char).collect())
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response(text: &str) -> Response {
        Response::new(text.to_string())
    }

    #[test]
    fn a_literal_is_the_size_that_was_announced() {
        assert_eq!(literal_len("* 1 FETCH (UID 4 BODY[] {28}"), Some(28));
        assert_eq!(literal_len("* 1 FETCH (UID 4 BODY[] ~{7}"), Some(7));
        assert_eq!(literal_len("* 1 FETCH (UID 4 BODY[] NIL)"), None);
        assert_eq!(literal_len("{oops}"), None);
    }

    #[test]
    fn the_capability_list_decides_whether_to_identify() {
        let reply = Reply {
            ok: true,
            status: "c1 OK done".into(),
            responses: vec![response("* CAPABILITY IMAP4rev1 ID AUTH=PLAIN")],
        };
        assert!(has_capability(&reply, "ID"));
        assert!(has_capability(&reply, "imap4rev1"));
        assert!(!has_capability(&reply, "IDLE"));
        let plain = Reply { ok: true, status: "c1 OK".into(), responses: vec![response("* CAPABILITY IMAP4rev1")] };
        assert!(!has_capability(&plain, "ID"));
    }

    #[test]
    fn a_search_answer_becomes_the_unseen_ids() {
        let reply = Reply {
            ok: true,
            status: "c4 OK SEARCH completed".into(),
            responses: vec![response("* SEARCH 3 11 42")],
        };
        assert_eq!(reply.uids(), vec![3, 11, 42]);
        assert_eq!(Reply { ok: true, status: "c4 OK".into(), responses: vec![] }.uids(), Vec::<u32>::new());
    }

    #[test]
    fn a_fetch_answer_becomes_the_messages() {
        let headers = concat!(
            "From: =?UTF-8?B?5byg5LiJ?= <zhang@example.com>\r\n",
            "Subject: =?UTF-8?B?5L2g5aW977yM5LiA5Liq5b6I6ZW/55qE5Li76aKY?=\r\n",
            "Date: Mon, 6 Oct 2025 10:00:00 +0800\r\n",
            "\r\n",
        );
        let reply = Reply {
            ok: true,
            status: "c5 OK Fetch completed".into(),
            responses: vec![Response {
                text: "* 7 FETCH (UID 42 BODY[HEADER.FIELDS (FROM SUBJECT DATE)] {150}".into(),
                literals: vec![headers.as_bytes().to_vec()],
            }],
        };
        let messages = reply.messages();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].uid, 42);
        assert_eq!(messages[0].from, "张三");
        assert_eq!(messages[0].subject, "你好，一个很长的主题");
        assert_eq!(messages[0].date, "Mon, 6 Oct 2025 10:00:00 +0800");
    }

    #[test]
    fn a_response_without_a_literal_is_not_a_message() {
        let reply = Reply {
            ok: true,
            status: "c5 OK".into(),
            responses: vec![response("* 7 FETCH (UID 42 BODY[] NIL)")],
        };
        assert!(reply.messages().is_empty());
    }

    #[test]
    fn headers_unfold_and_the_sender_keeps_its_name() {
        let raw = concat!(
            "From: \"Dupont, Jean\"\r\n",
            " <jean@example.com>\r\n",
            "Subject: A very long subject\r\n",
            " that was folded\r\n",
            "Date: Tue, 7 Oct 2025 08:30:00 +0800\r\n\r\n",
        );
        let headers = parse_headers(raw);
        assert_eq!(headers.from, "Dupont, Jean");
        assert_eq!(headers.subject, "A very long subject that was folded");
        assert_eq!(headers.date, "Tue, 7 Oct 2025 08:30:00 +0800");

        // No display name: the address itself, without its brackets.
        assert_eq!(parse_headers("From: <bare@example.com>\r\n").from, "bare@example.com");
        assert_eq!(parse_headers("From: bare@example.com\r\n").from, "bare@example.com");
    }

    #[test]
    fn encoded_words_are_decoded_in_both_encodings() {
        assert_eq!(decode_encoded_words("=?UTF-8?B?5L2g5aW9?="), "你好");
        assert_eq!(decode_encoded_words("=?UTF-8?Q?caf=C3=A9?="), "café");
        assert_eq!(decode_encoded_words("=?utf-8?Q?a_b?="), "a b");
        // Two words in a row: the space between them is not part of the text.
        assert_eq!(decode_encoded_words("=?UTF-8?B?5L2g?= =?UTF-8?B?5aW9?="), "你好");
        // Plain text and a word together keep their own spacing.
        assert_eq!(decode_encoded_words("Re: =?UTF-8?B?5L2g5aW9?= now"), "Re: 你好 now");
        // A charset we have no table for is left as it arrived.
        assert_eq!(decode_encoded_words("=?GBK?B?xOO6ww==?="), "=?GBK?B?xOO6ww==?=");
        // A lone "=?" is just text.
        assert_eq!(decode_encoded_words("2 =? 3"), "2 =? 3");
        assert_eq!(decode_encoded_words(""), "");
    }

    #[test]
    fn an_imap_string_is_quoted_and_escaped() {
        assert_eq!(quote("a@b.com"), "\"a@b.com\"");
        assert_eq!(quote("p\"a\\s"), "\"p\\\"a\\\\s\"");
    }

    /// The mailbox answers, and refuses a code that was never handed out.
    /// `cargo test -p coucou --lib mail -- --ignored`
    #[test]
    #[ignore]
    fn a_real_mailbox_refuses_a_wrong_code() {
        let refused = tauri::async_runtime::block_on(fetch("coucou-test@qq.com", "0000000000000000"));
        // Auth is what proves the whole way there worked: the name resolved, TLS
        // came up with the roots we ship, IMAP greeted us and the server answered
        // LOGIN. Anything else is the connection, not the credentials.
        match refused {
            Err(Error::Auth) => {}
            Err(other) => panic!("the mailbox did not answer as expected: {other}"),
            Ok(mailbox) => panic!("a made-up account was accepted: {mailbox:?}"),
        }
    }
}
