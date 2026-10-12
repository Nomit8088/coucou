// macOS backend for the shared Tauri app (not the legacy Swift application).
// AppKit calls run on the UI thread; cursor reads use public CoreGraphics APIs.
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{OnceLock, RwLock};

use super::{home_dir, DesktopMode, LocalTime, MouseShape};
use objc2::{class, msg_send, runtime::AnyObject};
use objc2_foundation::NSRect;
use tauri::{AppHandle, Monitor, WebviewWindow};

#[path = "../../../shared/macos_socket.rs"]
mod socket;

pub const HOME_VAR: &str = "HOME";
pub const HOOK_EXE: &str = "coucou-hook";
pub const CURSOR_POLL: bool = true;

pub fn config_dir() -> PathBuf {
    home_dir().join("Library/Application Support/Coucou")
}
pub fn local_dir() -> PathBuf {
    config_dir()
}
pub fn picture_dirs() -> Vec<PathBuf> {
    vec![
        home_dir().join("Pictures"),
        home_dir().join("Downloads"),
        home_dir(),
    ]
}
pub fn ensure_private_dir(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let m = std::fs::symlink_metadata(dir)?;
    if !m.is_dir() || m.file_type().is_symlink() || m.uid() != unsafe { libc::getuid() } {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "unsafe Coucou directory",
        ));
    }
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
}
pub fn prepare_environment() {
    let _ = socket::prepare();
    // Finder does not inherit the shell's PATH. Add the known executable paths
    // without invoking a login shell or executing shell startup files.
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|v| std::env::split_paths(&v).collect())
        .unwrap_or_default();
    for dir in [
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
        home_dir().join(".local/bin"),
        home_dir().join(".volta/bin"),
        home_dir().join(".bun/bin"),
    ] {
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    if let Ok(path) = std::env::join_paths(dirs) {
        std::env::set_var("PATH", path);
    }
}
pub fn relay_socket_path() -> Option<PathBuf> {
    socket::path("coucou.sock")
}
pub fn local_time() -> LocalTime {
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    unsafe {
        let now = libc::time(std::ptr::null_mut());
        libc::localtime_r(&now, &mut tm);
    }
    LocalTime {
        year: (tm.tm_year + 1900) as u32,
        month: (tm.tm_mon + 1) as u32,
        day: tm.tm_mday as u32,
        hour: tm.tm_hour as u32,
        minute: tm.tm_min as u32,
        second: tm.tm_sec as u32,
    }
}
pub fn user_full_name() -> Option<String> {
    unsafe {
        let mut pwd: libc::passwd = std::mem::zeroed();
        let mut result = std::ptr::null_mut();
        let mut buf = vec![0 as libc::c_char; 16 * 1024];
        if libc::getpwuid_r(
            libc::getuid(),
            &mut pwd,
            buf.as_mut_ptr(),
            buf.len(),
            &mut result,
        ) != 0
            || result.is_null()
            || pwd.pw_gecos.is_null()
        {
            return None;
        }
        let gecos = std::ffi::CStr::from_ptr(pwd.pw_gecos).to_string_lossy();
        let name = gecos.split(',').next()?.trim();
        (!name.is_empty()).then(|| name.to_string())
    }
}
pub fn no_console(cmd: &mut Command) -> &mut Command {
    cmd
}
pub fn open_url(url: &str) {
    let _ = Command::new("/usr/bin/open").arg(url).spawn();
}
pub fn reveal_folder(path: &str) {
    let _ = Command::new("/usr/bin/open").arg(path).spawn();
}
pub fn find_on_path(stem: &str) -> Option<PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|d| d.join(stem))
        .find(|p| {
            std::fs::metadata(p)
                .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
                .unwrap_or(false)
        })
}
pub fn codex_candidates() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = find_on_path("codex").into_iter().collect();
    let nvm = home_dir().join(".nvm/versions/node");
    if let Ok(entries) = std::fs::read_dir(&nvm) {
        let mut versions: Vec<String> = entries
            .filter_map(|e| e.ok()?.file_name().into_string().ok())
            .collect();
        versions.sort_by(|a, b| crate::codex_plan::compare_versions(b, a));
        out.extend(versions.iter().map(|v| nvm.join(v).join("bin/codex")));
    }
    out.retain(|p| {
        std::fs::metadata(p)
            .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    });
    out
}
pub fn open_claude_desktop() -> bool {
    Command::new("/usr/bin/open")
        .args(["-a", "Claude"])
        .spawn()
        .is_ok()
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Point {
    x: f64,
    y: f64,
}
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventCreate(source: *const std::ffi::c_void) -> *const std::ffi::c_void;
    fn CGEventGetLocation(event: *const std::ffi::c_void) -> Point;
    fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
}
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(object: *const std::ffi::c_void);
}

#[derive(Clone, Copy)]
struct Display {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    scale: f64,
    inset: f64,
}
fn displays() -> &'static RwLock<Vec<Display>> {
    static DISPLAYS: OnceLock<RwLock<Vec<Display>>> = OnceLock::new();
    DISPLAYS.get_or_init(|| RwLock::new(Vec::new()))
}
// NSScreen is main-thread-only. Snapshot its geometry whenever we place the
// island; CoreGraphics cursor points must use each display's own Retina scale.
fn refresh_displays() {
    unsafe {
        let screens: *mut AnyObject = msg_send![class!(NSScreen), screens];
        if screens.is_null() {
            return;
        }
        let count: usize = msg_send![screens, count];
        if count == 0 {
            return;
        }
        let primary: *mut AnyObject = msg_send![screens, objectAtIndex: 0usize];
        let primary_frame: NSRect = msg_send![primary, frame];
        let top = primary_frame.origin.y + primary_frame.size.height;
        let mut out = Vec::new();
        for i in 0..count {
            let screen: *mut AnyObject = msg_send![screens, objectAtIndex: i];
            let frame: NSRect = msg_send![screen, frame];
            let visible: NSRect = msg_send![screen, visibleFrame];
            let scale: f64 = msg_send![screen, backingScaleFactor];
            let inset =
                (frame.origin.y + frame.size.height - visible.origin.y - visible.size.height)
                    .max(0.0);
            out.push(Display {
                x: frame.origin.x,
                y: top - frame.origin.y - frame.size.height,
                w: frame.size.width,
                h: frame.size.height,
                scale,
                inset,
            });
        }
        *displays().write().unwrap() = out;
    }
}
pub fn monitor_top_inset(m: &Monitor) -> f64 {
    let scale = m.scale_factor();
    let x = m.position().x as f64 / scale;
    let y = m.position().y as f64 / scale;
    displays()
        .read()
        .unwrap()
        .iter()
        .find(|d| (d.x - x).abs() < 2.0 && (d.y - y).abs() < 2.0)
        .map(|d| d.inset)
        .unwrap_or(28.0)
}
pub fn cursor_logical() -> Option<(f64, f64)> {
    unsafe {
        let event = CGEventCreate(std::ptr::null());
        if event.is_null() {
            return None;
        }
        let p = CGEventGetLocation(event);
        CFRelease(event);
        Some((p.x, p.y))
    }
}
pub fn cursor_physical() -> Option<(f64, f64)> {
    let (x, y) = cursor_logical()?;
    let displays = displays().read().unwrap();
    let d = displays
        .iter()
        .find(|d| x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h)?;
    Some((x * d.scale, y * d.scale))
}
pub fn left_button_down() -> bool {
    unsafe { CGEventSourceButtonState(1, 0) }
}
pub fn make_non_activating(win: &WebviewWindow) {
    refresh_displays();
    let _ = win.set_focusable(false);
    let _ = win.set_visible_on_all_workspaces(true);
    if let Ok(raw) = win.ns_window() {
        unsafe {
            let window = raw.cast::<AnyObject>();
            let _: () = msg_send![window, setLevel: 25isize];
            let _: () = msg_send![window, setCollectionBehavior: (1usize | 256usize)];
            let _: () = msg_send![window, setHidesOnDeactivate: objc2::runtime::Bool::NO];
        }
    }
}
// Only called on the main thread by the synchronous Tauri command. Save the
// previous application by PID rather than holding an autoreleased ObjC object.
static PREVIOUS_APP: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);
pub fn set_activating(win: &WebviewWindow, activating: bool) {
    use std::sync::atomic::Ordering;
    if activating {
        unsafe {
            let workspace: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
            let front: *mut AnyObject = msg_send![workspace, frontmostApplication];
            if !front.is_null() {
                let pid: i32 = msg_send![front, processIdentifier];
                if pid > 0 && pid != libc::getpid() {
                    PREVIOUS_APP.store(pid, Ordering::Relaxed);
                }
            }
        }
        let _ = win.set_focusable(true);
        return;
    }
    let _ = win.set_focusable(false);
    if let Ok(raw) = win.ns_window() {
        unsafe {
            let window = raw.cast::<AnyObject>();
            let key: objc2::runtime::Bool = msg_send![window, isKeyWindow];
            // Don't steal focus from Settings or another app already clicked.
            if !key.as_bool() {
                return;
            }
            let _: () = msg_send![window, resignKeyWindow];
            let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let _: () = msg_send![app, deactivate];
            let pid = PREVIOUS_APP.swap(0, Ordering::Relaxed);
            if pid > 0 {
                let previous: *mut AnyObject = msg_send![class!(NSRunningApplication), runningApplicationWithProcessIdentifier: pid];
                if !previous.is_null() {
                    let _: objc2::runtime::Bool = msg_send![previous, activateWithOptions: 2usize];
                }
            }
        }
    }
}
pub fn pin_to_monitor(_win: &WebviewWindow, _x: i32, _y: i32) {
    refresh_displays();
}
pub fn set_input_region(_win: &WebviewWindow, _rect: Option<(f64, f64, f64, f64)>) {}
pub fn set_pointer_watch(_active: bool) {}
pub fn set_outside_click_watch(_win: &WebviewWindow, _active: bool) {}
pub fn unblock_webview_drops(_app: &AppHandle) {}
pub fn global_shortcuts_blocked() -> Option<&'static str> {
    None
}
pub fn ctrl_alt_types(_vk: u16, _shift: bool) -> Option<String> {
    None
}
// Exact terminal-window raising and floating desktop Mochi are not exposed in
// this first Tauri Mac port. Keep the working-folder fallback, not fake success.
pub fn process_ancestors(_pid: u32) -> Vec<u32> {
    Vec::new()
}
pub fn window_owners(_ancestors: &[u32]) -> Vec<u32> {
    Vec::new()
}
pub fn desktop_mode() -> DesktopMode {
    DesktopMode::Off
}
pub fn prepare_desktop_window(_win: &WebviewWindow, _mode: DesktopMode) -> bool {
    false
}
pub fn set_desktop_shape(_win: &WebviewWindow, _shape: MouseShape) {}
pub fn set_layer_margins(_win: &WebviewWindow, _x: f64, _y: f64) {}
pub fn set_layer_overlay(_win: &WebviewWindow, _on: bool) {}
pub fn layer_display(_island: &WebviewWindow, _mochi: &WebviewWindow) -> Option<(f64, f64)> {
    None
}
