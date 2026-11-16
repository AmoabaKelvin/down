//! Which vault is open and the ones opened before, kept as JSON in the app's config folder.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const IDENTIFIER: &str = "com.kelvinamoaba.down";
const MAX_RECENT: usize = 8;

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    pub vault: Option<String>,
    /// Vaults opened before, most recent first. The open one is included.
    pub recent: Vec<String>,
}

fn path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join("Library/Application Support").join(IDENTIFIER).join("prefs.json")
}

pub fn load() -> Prefs {
    fs::read_to_string(path()).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

pub fn update(change: impl FnOnce(&mut Prefs)) -> Result<Prefs, String> {
    let mut prefs = load();
    change(&mut prefs);
    prefs.recent.dedup();
    prefs.recent.truncate(MAX_RECENT);
    let path = path();
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(path, serde_json::to_string_pretty(&prefs).unwrap()).map_err(|e| e.to_string())?;
    Ok(prefs)
}

/// Puts a vault at the top of the recent list and makes it the open one.
pub fn remember(vault: &str) -> Result<Prefs, String> {
    update(|p| {
        p.recent.retain(|v| v != vault);
        p.recent.insert(0, vault.to_string());
        p.vault = Some(vault.to_string());
    })
}

pub fn forget(vault: &str) -> Result<Prefs, String> {
    update(|p| {
        p.recent.retain(|v| v != vault);
        if p.vault.as_deref() == Some(vault) {
            p.vault = None;
        }
    })
}
