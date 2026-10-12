//! Linux/macOS relay transport. A private directory plus same-user peer
//! credentials protect decisions; a bounded connect never holds up the agent.
use std::os::unix::net::UnixStream;
use std::path::PathBuf;

#[cfg(target_os = "macos")]
#[path = "../../shared/macos_socket.rs"]
mod macos_socket;
#[path = "../../shared/unix_connect.rs"]
mod transport;

#[cfg(target_os = "macos")]
fn socket_path() -> Option<PathBuf> {
    macos_socket::path("coucou.sock")
}

#[cfg(target_os = "linux")]
fn socket_path() -> Option<PathBuf> {
    use std::os::unix::fs::MetadataExt;
    let dir = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .unwrap_or_else(|| PathBuf::from(format!("/run/user/{}", unsafe { libc::getuid() })));
    let safe = std::fs::symlink_metadata(&dir)
        .map(|m| {
            m.is_dir()
                && !m.file_type().is_symlink()
                && m.uid() == unsafe { libc::getuid() }
                && m.mode() & 0o077 == 0
        })
        .unwrap_or(false);
    safe.then(|| dir.join("coucou.sock"))
}

pub fn connect() -> Option<UnixStream> {
    transport::connect(&socket_path()?, crate::CONNECT_TIMEOUT)
}
