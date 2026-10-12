// Bounded, same-user Unix transport used by both the hook and DSH steering.
use std::io;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::io::{AsRawFd, FromRawFd};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::time::{Duration, Instant};

pub fn connect(path: &Path, timeout: Duration) -> Option<UnixStream> {
    let deadline = Instant::now() + timeout;
    loop {
        match try_connect(path, deadline.saturating_duration_since(Instant::now())) {
            Ok(stream) => return same_user(&stream).then_some(stream),
            Err(e) => {
                if e.raw_os_error() != Some(libc::EAGAIN) || Instant::now() >= deadline {
                    return None;
                }
                std::thread::sleep(Duration::from_millis(15));
            }
        }
    }
}
fn try_connect(path: &Path, timeout: Duration) -> io::Result<UnixStream> {
    let fd = unsafe { libc::socket(libc::AF_UNIX, libc::SOCK_STREAM, 0) };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    let stream = unsafe { UnixStream::from_raw_fd(fd) };
    stream.set_nonblocking(true)?;
    if unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) } < 0 {
        return Err(io::Error::last_os_error());
    }
    let mut addr: libc::sockaddr_un = unsafe { std::mem::zeroed() };
    addr.sun_family = libc::AF_UNIX as libc::sa_family_t;
    #[cfg(target_os = "macos")]
    {
        addr.sun_len = std::mem::size_of::<libc::sockaddr_un>() as u8;
    }
    let bytes = path.as_os_str().as_bytes();
    if bytes.len() >= addr.sun_path.len() {
        return Err(io::Error::from(io::ErrorKind::InvalidInput));
    }
    for (dst, src) in addr.sun_path.iter_mut().zip(bytes) {
        *dst = *src as libc::c_char;
    }
    if unsafe {
        libc::connect(
            fd,
            (&addr as *const libc::sockaddr_un).cast(),
            std::mem::size_of_val(&addr) as libc::socklen_t,
        )
    } != 0
    {
        let error = io::Error::last_os_error();
        if error.raw_os_error() != Some(libc::EINPROGRESS) {
            return Err(error);
        }
        let mut poll = libc::pollfd {
            fd,
            events: libc::POLLOUT,
            revents: 0,
        };
        if unsafe {
            libc::poll(
                &mut poll,
                1,
                timeout.as_millis().min(i32::MAX as u128) as i32,
            )
        } <= 0
        {
            return Err(io::Error::from(io::ErrorKind::TimedOut));
        }
        if let Some(error) = stream.take_error()? {
            return Err(error);
        }
    }
    stream.set_nonblocking(false)?;
    Ok(stream)
}
#[cfg(target_os = "macos")]
fn same_user(stream: &UnixStream) -> bool {
    let mut uid = 0;
    let mut gid = 0;
    unsafe {
        libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) == 0 && uid == libc::getuid()
    }
}
#[cfg(target_os = "linux")]
fn same_user(stream: &UnixStream) -> bool {
    let mut cred: libc::ucred = unsafe { std::mem::zeroed() };
    let mut len = std::mem::size_of_val(&cred) as libc::socklen_t;
    unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&mut cred as *mut libc::ucred).cast(),
            &mut len,
        ) == 0
            && len as usize == std::mem::size_of_val(&cred)
            && cred.uid == libc::getuid()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_closed_app_returns_without_waiting() {
        let path = std::env::temp_dir().join(format!("coucou-missing-{}.sock", std::process::id()));
        let start = Instant::now();
        assert!(connect(&path, Duration::from_millis(300)).is_none());
        assert!(start.elapsed() < Duration::from_secs(1));
    }
    #[test]
    fn accepts_a_same_user_server() {
        let path = std::env::temp_dir().join(format!("coucou-connect-{}.sock", std::process::id()));
        let listener = std::os::unix::net::UnixListener::bind(&path).unwrap();
        assert!(connect(&path, Duration::from_millis(300)).is_some());
        drop(listener);
        std::fs::remove_file(path).unwrap();
    }
}
