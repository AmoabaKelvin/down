//! Tells the page when something in the vault changes on disk because of something other than
//! the app: another editor, a sync service, git, an agent.

use crate::vault;
use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// What the app itself last wrote to each note, so its own saves don't echo back.
pub type Written = Arc<Mutex<HashMap<String, String>>>;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Changed {
    /// Notes whose text changed, with what's in them now.
    notes: Vec<NoteChange>,
    /// Whether anything else changed: a note or folder added, removed or renamed.
    structure: bool,
}

#[derive(Serialize, Clone)]
struct NoteChange {
    path: String,
    content: Option<String>,
}

pub fn start(app: AppHandle, root: PathBuf, written: Written) -> Result<Debouncer<RecommendedWatcher>, String> {
    let watched = root.clone();
    let mut debouncer = new_debouncer(Duration::from_millis(160), move |result: DebounceEventResult| {
        let Ok(events) = result else { return };
        let mut notes = Vec::new();
        let mut structure = false;
        for event in events {
            let path = &event.path;
            if vault::is_hidden(&root, path) || path.to_string_lossy().ends_with(".tmp") {
                continue;
            }
            let Some(rel) = vault::relative(&root, path) else { continue };
            if !vault::is_note(path) {
                structure |= !path.exists() || path.is_dir();
                continue;
            }
            match fs::read_to_string(path) {
                Ok(content) => {
                    if written.lock().unwrap().get(&rel) == Some(&content) {
                        continue;
                    }
                    notes.push(NoteChange { path: rel, content: Some(content) });
                }
                Err(_) => {
                    structure = true;
                    notes.push(NoteChange { path: rel, content: None });
                }
            }
        }
        if !notes.is_empty() || structure {
            let _ = app.emit("down://changed", Changed { notes, structure });
        }
    })
    .map_err(|e| e.to_string())?;
    debouncer.watcher().watch(Path::new(&watched), RecursiveMode::Recursive).map_err(|e| e.to_string())?;
    Ok(debouncer)
}
