// Shared by the app and its relay. Never use an unchecked shared /tmp socket:
// this endpoint carries explicit approval decisions and must belong to this uid.
use std::os::unix::fs::{DirBuilderExt, MetadataExt};
use std::path::{Path, PathBuf};

pub fn is_private_dir(path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .map(|m| {
            m.is_dir()
                && !m.file_type().is_symlink()
                && m.uid() == unsafe { libc::getuid() }
                && m.mode() & 0o077 == 0
        })
        .unwrap_or(false)
}

pub fn directory() -> PathBuf {
    // Short enough for Darwin's 104-byte sockaddr_un, even with a long HOME.
    PathBuf::from(format!("/tmp/coucou-{}", unsafe { libc::getuid() }))
}

pub fn prepare() -> std::io::Result<()> {
    let dir = directory();
    match std::fs::DirBuilder::new().mode(0o700).create(&dir) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(e),
    }
    if is_private_dir(&dir) {
        Ok(())
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "unsafe Coucou socket directory",
        ))
    }
}

pub fn path(name: &str) -> Option<PathBuf> {
    let dir = directory();
    is_private_dir(&dir).then(|| dir.join(name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};

    #[test]
    fn rejects_public_directories_and_symlinks() {
        let dir = std::env::temp_dir().join(format!("coucou-private-test-{}", std::process::id()));
        let link = dir.with_extension("link");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(is_private_dir(&dir));
        symlink(&dir, &link).unwrap();
        assert!(!is_private_dir(&link));
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(!is_private_dir(&dir));
        std::fs::remove_file(link).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
}
