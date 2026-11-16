mod prefs;
mod trash;
mod vault;
mod watch;

use base64::Engine;
use notify_debouncer_mini::{notify::RecommendedWatcher, Debouncer};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, RunEvent};

struct State {
    vault: Mutex<Option<PathBuf>>,
    written: watch::Written,
    watcher: Mutex<Option<Debouncer<RecommendedWatcher>>>,
}

impl State {
    fn root(&self) -> Result<PathBuf, String> {
        self.vault.lock().unwrap().clone().ok_or_else(|| "No vault is open.".into())
    }

    fn remember_write(&self, path: String, content: String) {
        self.written.lock().unwrap().insert(path, content);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultInfo {
    /// The open vault, if any.
    path: Option<String>,
    name: Option<String>,
    recent: Vec<RecentVault>,
    home: String,
}

#[derive(Serialize)]
struct RecentVault {
    path: String,
    name: String,
    /// Shown as "~/Notes".
    display: String,
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into()))
}

fn tilde(path: &Path) -> String {
    match path.strip_prefix(home()) {
        Ok(rest) => format!("~/{}", rest.display()),
        Err(_) => path.display().to_string(),
    }
}

fn info(state: &State) -> VaultInfo {
    let open = state.vault.lock().unwrap().clone();
    let recent = prefs::load()
        .recent
        .into_iter()
        .filter(|p| Path::new(p).is_dir())
        .map(|p| RecentVault { name: vault::name_of(Path::new(&p)), display: tilde(Path::new(&p)), path: p })
        .collect();
    VaultInfo { name: open.as_deref().map(vault::name_of), path: open.map(|p| p.display().to_string()), recent, home: home().display().to_string() }
}

/// Makes a folder the open vault: remembers it, lets the page load its images, and watches it.
fn open(app: &AppHandle, state: &State, path: PathBuf) -> Result<(), String> {
    if !path.is_dir() {
        return Err(format!("{} isn't a folder.", tilde(&path)));
    }
    let path = path.canonicalize().unwrap_or(path);
    prefs::remember(&path.display().to_string())?;
    let _ = app.asset_protocol_scope().allow_directory(&path, true);
    state.written.lock().unwrap().clear();
    let watcher = match watch::start(app.clone(), path.clone(), state.written.clone()) {
        Ok(watcher) => Some(watcher),
        Err(error) => {
            eprintln!("down: not watching {}: {error}", path.display());
            None
        }
    };
    *state.watcher.lock().unwrap() = watcher;
    *state.vault.lock().unwrap() = Some(path);
    Ok(())
}

#[tauri::command]
fn get_vault(state: tauri::State<State>) -> VaultInfo {
    info(&state)
}

#[tauri::command]
fn open_vault(app: AppHandle, state: tauri::State<State>, path: String) -> Result<VaultInfo, String> {
    open(&app, &state, PathBuf::from(path))?;
    Ok(info(&state))
}

/// Makes a new vault folder with a first note in it, and opens it.
#[tauri::command]
fn create_vault(app: AppHandle, state: tauri::State<State>, parent: String, name: String) -> Result<VaultInfo, String> {
    let name = vault::clean_name(&name);
    if name.is_empty() {
        return Err("Give the vault a name.".into());
    }
    let path = PathBuf::from(parent).join(&name);
    if path.exists() && fs::read_dir(&path).map(|mut d| d.next().is_some()).unwrap_or(true) {
        return Err(format!("{} already exists. Open it instead?", tilde(&path)));
    }
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    vault::write(&path, "Welcome.md", WELCOME)?;
    open(&app, &state, path)?;
    Ok(info(&state))
}

const WELCOME: &str = "This vault is a folder of plain markdown files. Anything that can open a text file can open your notes, and Down picks up changes made elsewhere straight away.\n\n## Getting around\n\n- [ ] Make a note with ⌘N, or a folder with ⌘⇧N\n- [ ] Find anything with ⌘K, by title or by what's inside\n- [ ] Type [[ to link to another note, and / for headings, lists and more\n- [ ] Drag notes onto folders in the sidebar to file them\n\nRight-click anything in the sidebar to rename it, pin it to the top, or move it to the Trash.\n";

#[tauri::command]
fn close_vault(state: tauri::State<State>) -> Result<VaultInfo, String> {
    *state.watcher.lock().unwrap() = None;
    *state.vault.lock().unwrap() = None;
    prefs::update(|p| p.vault = None)?;
    Ok(info(&state))
}

#[tauri::command]
fn forget_vault(state: tauri::State<State>, path: String) -> Result<VaultInfo, String> {
    prefs::forget(&path)?;
    Ok(info(&state))
}

/// Runs file work off the main thread, so a big vault never stalls the window.
async fn blocking<T: Send + 'static>(app: AppHandle, work: impl FnOnce(&State) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || work(&app.state::<State>())).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn vault_index(app: AppHandle) -> Result<vault::Index, String> {
    blocking(app, |state| vault::index(&state.root()?)).await
}

#[tauri::command]
async fn read_note(app: AppHandle, path: String) -> Result<String, String> {
    blocking(app, move |state| vault::read(&state.root()?, &path)).await
}

#[tauri::command]
fn save_note(state: tauri::State<State>, path: String, content: String) -> Result<(), String> {
    let written = vault::write(&state.root()?, &path, &content)?;
    state.remember_write(path, written);
    Ok(())
}

#[tauri::command]
fn create_note(state: tauri::State<State>, folder: String, name: String, content: Option<String>) -> Result<String, String> {
    let content = content.unwrap_or_default();
    let path = vault::create_note(&state.root()?, &folder, &name, &content)?;
    state.remember_write(path.clone(), content);
    Ok(path)
}

#[tauri::command]
fn create_folder(state: tauri::State<State>, parent: String, name: String) -> Result<String, String> {
    vault::create_folder(&state.root()?, &parent, &name)
}

#[derive(Serialize)]
struct Moved {
    path: String,
    updated: Vec<String>,
}

#[tauri::command]
async fn rename_entry(app: AppHandle, path: String, name: String) -> Result<Moved, String> {
    blocking(app, move |state| {
        let renamed = vault::rename(&state.root()?, &path, &name, &mut |p, c| state.remember_write(p, c))?;
        Ok(Moved { path: renamed.path, updated: renamed.updated })
    })
    .await
}

#[tauri::command]
async fn move_entry(app: AppHandle, path: String, folder: String) -> Result<Moved, String> {
    blocking(app, move |state| {
        let moved = vault::move_into(&state.root()?, &path, &folder, &mut |p, c| state.remember_write(p, c))?;
        Ok(Moved { path: moved.path, updated: moved.updated })
    })
    .await
}

/// Moves a note or folder to the Trash; returns where it went, for Undo.
#[tauri::command]
fn trash_entry(state: tauri::State<State>, path: String) -> Result<String, String> {
    let at = trash::trash(&vault::resolve(&state.root()?, &path)?)?;
    Ok(at.display().to_string())
}

/// Brings something back from the Trash to where it was.
#[tauri::command]
fn restore_entry(state: tauri::State<State>, trashed: String, path: String) -> Result<(), String> {
    let to = vault::resolve(&state.root()?, &path)?;
    if to.exists() {
        return Err("Something else has its place now.".into());
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(trashed, to).map_err(|e| e.to_string())
}

#[tauri::command]
async fn search_vault(app: AppHandle, query: String) -> Result<Vec<vault::Hit>, String> {
    blocking(app, move |state| vault::search(&state.root()?, &query, 40)).await
}

#[tauri::command]
fn save_attachment(state: tauri::State<State>, name: String, data: String) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
    vault::save_attachment(&state.root()?, &name, &bytes)
}

/// Shows the vault, or something in it, in Finder.
#[tauri::command]
fn reveal(state: tauri::State<State>, path: Option<String>) -> Result<(), String> {
    let root = state.root()?;
    let target = match path.as_deref() {
        Some(rel) if !rel.is_empty() => vault::resolve(&root, rel)?,
        _ => root,
    };
    let mut command = std::process::Command::new("open");
    if target.is_file() {
        command.arg("-R");
    }
    command.arg(target).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Called by the page once it has saved, after we asked it to on quit.
#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

/// Asks the page to flush its pending save, then quits (or quits anyway after a moment).
fn quit_gracefully(app: &AppHandle) {
    let _ = app.emit_to("main", "down://quit", ());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1500));
        app.exit(0);
    });
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(State { vault: Mutex::new(None), written: Default::default(), watcher: Mutex::new(None) })
        .setup(|app| {
            let handle = app.handle();
            if let Some(path) = prefs::load().vault {
                if let Err(error) = open(handle, &app.state::<State>(), PathBuf::from(&path)) {
                    eprintln!("down: couldn't reopen {path}: {error}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_vault,
            open_vault,
            create_vault,
            close_vault,
            forget_vault,
            vault_index,
            read_note,
            save_note,
            create_note,
            create_folder,
            rename_entry,
            move_entry,
            trash_entry,
            restore_entry,
            search_vault,
            save_attachment,
            reveal,
            quit
        ])
        // Closing the window hides it, like most Mac apps; the Dock icon brings it back.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building down")
        .run(|app, event| match event {
            RunEvent::ExitRequested { api, code: None, .. } => {
                api.prevent_exit();
                quit_gracefully(app);
            }
            RunEvent::Reopen { .. } => show_main(app),
            _ => {}
        });
}
