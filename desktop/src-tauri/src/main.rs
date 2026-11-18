// Portable desktop shell for client-task-tracker.html.
//
// Everything lives in a "TaskTrackerData" folder next to the exe:
//   store.json          the app's data (what the browser version keeps in localStorage)
//   backups/            one copy of store.json per day, newest 30 kept
//   webview/            WebView2's own profile (prefs, snapshot keys), so nothing goes to AppData
// No registry writes, no installer, no network: the page's CSP only allows the app itself
// and this process's IPC (see tauri.conf.json).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{State, WebviewUrl, WebviewWindowBuilder};

const BACKUPS_KEPT: usize = 30;

struct Store {
    dir: PathBuf,
    data: Mutex<BTreeMap<String, String>>,
}

impl Store {
    fn file(&self) -> PathBuf {
        self.dir.join("store.json")
    }

    fn load(dir: PathBuf) -> Result<Store, String> {
        fs::create_dir_all(dir.join("backups")).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
        let file = dir.join("store.json");
        let data = match fs::read_to_string(&file) {
            Ok(text) => serde_json::from_str(&text).map_err(|e| {
                // Never start on top of a file we can't read - that would overwrite it on the
                // first save. The user can restore from backups/ instead.
                format!("{} is damaged ({e}). Restore a copy from the backups folder.", file.display())
            })?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
            Err(e) => return Err(format!("cannot read {}: {e}", file.display())),
        };
        let store = Store { dir, data: Mutex::new(data) };
        store.daily_backup();
        Ok(store)
    }

    // Copies store.json to backups/store-YYYY-MM-DD.json the first time it is touched on a
    // given day (startup, or the first save after midnight if the app stays open).
    fn daily_backup(&self) {
        let src = self.file();
        if !src.exists() {
            return;
        }
        let backups = self.dir.join("backups");
        let today = chrono::Local::now().format("%Y-%m-%d");
        let dest = backups.join(format!("store-{today}.json"));
        if dest.exists() || fs::copy(&src, &dest).is_err() {
            return;
        }
        let mut old: Vec<PathBuf> = fs::read_dir(&backups)
            .map(|rd| rd.filter_map(|e| e.ok().map(|e| e.path())).collect())
            .unwrap_or_default();
        old.retain(|p| {
            p.file_name().and_then(|n| n.to_str()).map_or(false, |n| n.starts_with("store-") && n.ends_with(".json"))
        });
        old.sort(); // date-stamped names sort chronologically
        while old.len() > BACKUPS_KEPT {
            let _ = fs::remove_file(old.remove(0));
        }
    }

    // Write to a temp file and rename over the real one, so a crash or power cut mid-save
    // leaves either the old file or the new one - never half of each.
    fn persist(&self, data: &BTreeMap<String, String>) -> Result<(), String> {
        self.daily_backup();
        let text = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
        let tmp = self.dir.join("store.json.tmp");
        fs::write(&tmp, text).map_err(|e| format!("save failed: {e}"))?;
        fs::rename(&tmp, self.file()).map_err(|e| format!("save failed: {e}"))
    }
}

#[tauri::command]
fn storage_get(store: State<Store>, key: String) -> Option<String> {
    store.data.lock().unwrap().get(&key).cloned()
}

#[tauri::command]
fn storage_set(store: State<Store>, key: String, value: String) -> Result<(), String> {
    let mut data = store.data.lock().unwrap();
    let previous = data.insert(key.clone(), value);
    store.persist(&data).map_err(|e| {
        // keep memory in step with disk if the write failed
        match previous {
            Some(p) => data.insert(key, p),
            None => data.remove(&key),
        };
        e
    })
}

fn data_dir() -> PathBuf {
    let exe = std::env::current_exe().expect("cannot locate the exe");
    exe.parent().unwrap_or(Path::new(".")).join("TaskTrackerData")
}

// Installed before the page's own script runs. The page already prefers window.storage over
// localStorage when it exists, so this is the only bridge it needs.
const BRIDGE: &str = r#"
window.__TASKTRACKER_DESKTOP__ = true;
window.storage = {
  get: async (key) => {
    const v = await window.__TAURI_INTERNALS__.invoke('storage_get', { key });
    return v === null || v === undefined ? null : { value: v };
  },
  set: async (key, value) => {
    await window.__TAURI_INTERNALS__.invoke('storage_set', { key, value });
  }
};
"#;

fn main() {
    let dir = data_dir();
    let store = match Store::load(dir.clone()) {
        Ok(s) => s,
        Err(msg) => {
            eprintln!("{msg}");
            #[cfg(windows)]
            show_error(&msg);
            std::process::exit(1);
        }
    };
    tauri::Builder::default()
        .manage(store)
        .invoke_handler(tauri::generate_handler![storage_get, storage_set])
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("client-task-tracker.html".into()))
                .title("Task Tracker")
                .inner_size(1100.0, 800.0)
                .min_inner_size(420.0, 500.0)
                .data_directory(dir.join("webview"))
                .initialization_script(BRIDGE)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the app");
}

// A plain Win32 message box, so a startup problem is visible instead of the exe silently
// closing (it has no console window).
#[cfg(windows)]
fn show_error(msg: &str) {
    use std::os::windows::ffi::OsStrExt;
    let wide = |s: &str| std::ffi::OsStr::new(s).encode_wide().chain(Some(0)).collect::<Vec<u16>>();
    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(hwnd: *mut std::ffi::c_void, text: *const u16, caption: *const u16, kind: u32) -> i32;
    }
    unsafe {
        MessageBoxW(std::ptr::null_mut(), wide(msg).as_ptr(), wide("Task Tracker").as_ptr(), 0x10);
    }
}
