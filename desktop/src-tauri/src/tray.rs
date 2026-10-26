// Notification-area icon: Open, Weekly recap, Wardrobe, Settings, Pause, Quit.
// While a new version waits (the island's blue Mochi), the tray Mochi turns blue too.

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::i18n::{n_, t};
use crate::island::WINDOW_LABEL;

/// The menu's items, id and English label, in order. The labels are shown in
/// the interface language (i18n.rs) and follow it when it changes.
const ITEMS: [(&str, &str); 7] = [
    ("open", n_("Open Coucou")),
    ("recap", n_("Weekly recap")),
    ("wardrobe", n_("Wardrobe…")),
    ("settings", n_("Settings…")),
    ("update", n_("Check for updates…")),
    ("pause", n_("Pause")),
    ("quit", n_("Quit")),
];

/// Kept so a language change relabels the menu without rebuilding the tray.
struct Items(Vec<(&'static str, MenuItem<Wry>)>);

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let mut items = Vec::new();
    for (id, label) in ITEMS {
        items.push((label, MenuItem::with_id(app, id, t(label), true, None::<&str>)?));
    }
    let [open, recap, wardrobe, settings, update, pause, quit] = [0, 1, 2, 3, 4, 5, 6].map(|i| &items[i].1);
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(app, &[open, recap, &sep1, wardrobe, settings, update, pause, &sep2, quit])?;
    app.manage(Items(items));

    let mut builder = TrayIconBuilder::with_id("coucou")
        .tooltip("Coucou")
        .menu(&menu)
        .on_menu_event(|app: &AppHandle, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "settings" | "update" => crate::show_settings_window(app),
            id => dispatch(app, id),
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

/// Shared with the single-instance callback: reopening the app must also
/// recover a window that is still alive but has fallen behind other apps.
pub fn dispatch(app: &AppHandle, action: &str) {
    if matches!(action, "open" | "recap" | "wardrobe") {
        crate::island::restore_window(app);
    }
    if let Err(err) = app.emit_to(WINDOW_LABEL, "tray", action.to_string()) {
        crate::log::line(format!("tray {action} failed: {err}"));
    }
}

/// Relabels the menu in the current language.
pub fn retitle(app: &AppHandle) {
    let Some(items) = app.try_state::<Items>() else { return };
    for (label, item) in &items.0 {
        let _ = item.set_text(t(label));
    }
}

/// Coucou's update blue, #3B82F6, the colour of Mochi while a new version waits.
const UPDATE_BLUE: [f32; 3] = [59.0, 130.0, 246.0];

/// The tray Mochi in the update blue: the light body takes the blue and keeps its
/// shading, the dark outline and eyes stay as they are, transparency untouched.
pub fn tint_blue(rgba: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(rgba.len());
    for p in rgba.chunks_exact(4) {
        let light = (0.2126 * p[0] as f32 + 0.7152 * p[1] as f32 + 0.0722 * p[2] as f32) / 255.0;
        // 0 for the outline and eyes, 1 for the white body.
        let body = ((light - 0.35) / 0.65).clamp(0.0, 1.0);
        for (i, blue) in UPDATE_BLUE.iter().enumerate() {
            let shaded = blue * (0.8 + 0.2 * light);
            out.push((p[i] as f32 * (1.0 - body) + shaded * body).round().clamp(0.0, 255.0) as u8);
        }
        out.push(p[3]);
    }
    out
}

/// The island says whether a new version waits (a newer release, not postponed
/// with Later): blue Mochi in the tray, or the usual one.
#[tauri::command]
pub fn tray_update_hint(app: AppHandle, on: bool) {
    let Some(tray) = app.tray_by_id("coucou") else { return };
    let Some(base) = app.default_window_icon() else { return };
    let icon = if on {
        Image::new_owned(tint_blue(base.rgba()), base.width(), base.height())
    } else {
        base.clone().to_owned()
    };
    let _ = tray.set_icon(Some(icon));
}

#[cfg(test)]
mod tests {
    use super::tint_blue;

    #[test]
    fn the_body_turns_blue_the_outline_stays() {
        let px = [
            245, 240, 235, 255, // the off-white body
            10, 10, 10, 255, // the outline
            250, 250, 250, 0, // transparent around Mochi
        ];
        let out = tint_blue(&px);
        let body = &out[0..4];
        let outline = &out[4..8];
        let clear = &out[8..12];
        // The body is blue and still light, not a flat fill: the shading is kept.
        assert!(body[2] > body[0] + 20, "the body should lean blue: {body:?}");
        assert!(body[2] > 180, "the body should stay light: {body:?}");
        // The outline is dark and unchanged.
        assert_eq!(outline, &[10, 10, 10, 255]);
        // Transparency is untouched, colour and all.
        assert_eq!(clear[3], 0);
    }
}
