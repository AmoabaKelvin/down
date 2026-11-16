//! Moving to the Trash through Finder's own API, which says where the item ended up so it can come back.

use objc2_foundation::{NSFileManager, NSString, NSURL};
use std::path::{Path, PathBuf};

/// Moves the item to the Trash and returns where it is now.
pub fn trash(path: &Path) -> Result<PathBuf, String> {
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    let mut resulting = None;
    NSFileManager::defaultManager().trashItemAtURL_resultingItemURL_error(&url, Some(&mut resulting))
        .map_err(|e| e.localizedDescription().to_string())?;
    resulting.and_then(|url| url.path()).map(|p| PathBuf::from(p.to_string())).ok_or_else(|| "Moved to the Trash, but it can't be put back from here.".into())
}
