//! A vault is a folder of markdown notes, with folders inside it. Paths handed to and from the page
//! are relative to the vault and always use `/`.

use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Folders that are never shown: tooling and other apps' settings.
const SKIP: &[&str] = &["node_modules", "target"];
const MAX_DEPTH: usize = 24;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    pub path: String,
    pub modified: f64,
    pub created: f64,
    pub size: u64,
    /// `[[wikilink]]` targets, without any `#heading` or `|alias`.
    pub wikilinks: Vec<String>,
    /// Markdown links to other notes, as vault paths.
    pub links: Vec<String>,
    /// The first line of prose, for previews.
    pub excerpt: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Index {
    pub name: String,
    pub root: String,
    pub folders: Vec<String>,
    pub notes: Vec<NoteMeta>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub path: String,
    /// The line the first match is on, trimmed around it.
    pub snippet: String,
    pub count: usize,
}

pub fn name_of(root: &Path) -> String {
    root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| root.display().to_string())
}

/// A vault path made absolute. Anything that would step outside the vault is refused.
pub fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = Path::new(rel);
    let mut out = root.to_path_buf();
    for part in rel.components() {
        match part {
            Component::Normal(name) => out.push(name),
            Component::CurDir => {}
            _ => return Err(format!("not a path inside the vault: {}", rel.display())),
        }
    }
    Ok(out)
}

/// The vault path of an absolute path inside it.
pub fn relative(root: &Path, path: &Path) -> Option<String> {
    let rest = path.strip_prefix(root).ok()?;
    let parts: Vec<String> = rest.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    Some(parts.join("/"))
}

pub fn is_note(path: &Path) -> bool {
    path.extension().is_some_and(|e| e.eq_ignore_ascii_case("md"))
}

/// Hidden files and folders, and tooling folders, stay out of the vault's tree and its watcher.
pub fn is_hidden(root: &Path, path: &Path) -> bool {
    path.strip_prefix(root).map_or(true, |rest| {
        rest.components().any(|c| {
            let name = c.as_os_str().to_string_lossy();
            name.starts_with('.') || SKIP.contains(&name.as_ref())
        })
    })
}

fn millis(time: std::io::Result<SystemTime>) -> f64 {
    time.ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as f64).unwrap_or(0.0)
}

pub fn index(root: &Path) -> Result<Index, String> {
    if !root.is_dir() {
        return Err(format!("{} isn't a folder any more", root.display()));
    }
    let mut folders = Vec::new();
    let mut notes = Vec::new();
    walk(root, root, 0, &mut folders, &mut notes);
    folders.sort();
    notes.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(Index { name: name_of(root), root: root.display().to_string(), folders, notes })
}

fn walk(root: &Path, dir: &Path, depth: usize, folders: &mut Vec<String>, notes: &mut Vec<NoteMeta>) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || SKIP.contains(&name.as_str()) {
            continue;
        }
        let Ok(kind) = entry.file_type() else { continue };
        let Some(rel) = relative(root, &path) else { continue };
        if kind.is_dir() {
            folders.push(rel);
            walk(root, &path, depth + 1, folders, notes);
        } else if kind.is_file() && is_note(&path) {
            let meta = entry.metadata().ok();
            let content = fs::read_to_string(&path).unwrap_or_default();
            let parent = Path::new(&rel).parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
            notes.push(NoteMeta {
                wikilinks: wikilinks(&content).into_iter().map(|l| l.target.to_string()).collect(),
                links: markdown_links(&content, &parent),
                excerpt: excerpt(&content),
                modified: millis(meta.as_ref().map_or(Err(std::io::ErrorKind::Other.into()), |m| m.modified())),
                created: millis(meta.as_ref().map_or(Err(std::io::ErrorKind::Other.into()), |m| m.created())),
                size: meta.map_or(0, |m| m.len()),
                path: rel,
            });
        }
    }
}

/// Where the body starts, after any YAML front matter.
fn body_start(content: &str) -> usize {
    if let Some(rest) = content.strip_prefix("---\n") {
        if let Some(end) = rest.find("\n---") {
            let after = 4 + end + 4;
            return content[after..].find('\n').map_or(content.len(), |n| after + n + 1);
        }
    }
    0
}

fn excerpt(content: &str) -> String {
    let body = &content[body_start(content)..];
    for line in body.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with("```") || line.starts_with("---") || line.starts_with('|') {
            continue;
        }
        let text = line.trim_start_matches(|c: char| matches!(c, '-' | '*' | '+' | '>' | ' ')).trim_start_matches("[ ] ").trim_start_matches("[x] ");
        let text: String = text.chars().filter(|c| !matches!(c, '*' | '_' | '`')).collect();
        let text = text.replace("[[", "").replace("]]", "");
        if text.trim().is_empty() {
            continue;
        }
        return text.chars().take(140).collect();
    }
    String::new()
}

pub struct WikiLink<'a> {
    /// Byte range of the target inside the content.
    pub start: usize,
    pub end: usize,
    pub target: &'a str,
}

/// Every `[[target#heading|alias]]` in the content, outside code.
pub fn wikilinks(content: &str) -> Vec<WikiLink<'_>> {
    let mut found = Vec::new();
    let mut in_fence = false;
    let mut offset = 0;
    for line in content.split_inclusive('\n') {
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
        }
        if !in_fence {
            let mut from = 0;
            while let Some(open) = line[from..].find("[[") {
                let start = from + open + 2;
                let Some(close) = line[start..].find("]]") else { break };
                let inner = &line[start..start + close];
                // Code spans: skip a link inside backticks, roughly, by counting them before it.
                let ticks = line[..start].matches('`').count();
                if !inner.is_empty() && !inner.contains('[') && ticks % 2 == 0 {
                    let target_len = inner.find(['#', '|']).unwrap_or(inner.len());
                    let target = &inner[..target_len];
                    let trimmed = target.trim();
                    if !trimmed.is_empty() {
                        let lead = target.len() - target.trim_start().len();
                        found.push(WikiLink { start: offset + start + lead, end: offset + start + lead + trimmed.len(), target: trimmed });
                    }
                }
                from = start + close + 2;
            }
        }
        offset += line.len();
    }
    found
}

/// `[text](other.md)` links to notes, resolved against the linking note's folder.
fn markdown_links(content: &str, parent: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut from = 0;
    while let Some(at) = content[from..].find("](") {
        let start = from + at + 2;
        let Some(len) = content[start..].find(')') else { break };
        let href = content[start..start + len].split_whitespace().next().unwrap_or("");
        from = start + len;
        if href.contains("://") || href.starts_with('#') {
            continue;
        }
        let href = percent_decode(href.split('#').next().unwrap_or(""));
        if !href.to_ascii_lowercase().ends_with(".md") {
            continue;
        }
        if let Some(path) = join(parent, &href) {
            found.push(path);
        }
    }
    found
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&text[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A relative path joined onto a folder, with `.` and `..` worked out. None if it leaves the vault.
fn join(folder: &str, rel: &str) -> Option<String> {
    let mut parts: Vec<&str> = if rel.starts_with('/') { vec![] } else { folder.split('/').filter(|p| !p.is_empty()).collect() };
    for part in rel.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            name => parts.push(name),
        }
    }
    Some(parts.join("/"))
}

pub fn read(root: &Path, rel: &str) -> Result<String, String> {
    fs::read_to_string(resolve(root, rel)?).map_err(|e| e.to_string())
}

/// Writes a note atomically and returns exactly what's now on disk.
pub fn write(root: &Path, rel: &str, content: &str) -> Result<String, String> {
    let path = resolve(root, rel)?;
    let body = if content.is_empty() || content.ends_with('\n') { content.to_string() } else { format!("{content}\n") };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension(format!("md.{}.tmp", std::process::id()));
    fs::write(&tmp, &body).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(body)
}

/// A name with the characters that can't go in a file name taken out.
pub fn clean_name(name: &str) -> String {
    // Besides what the file system refuses, [ ] # | ^ would break a [[link]] to it.
    let cleaned: String = name.chars().map(|c| if matches!(c, '/' | ':' | '\\' | '[' | ']' | '#' | '|' | '^') || c.is_control() { ' ' } else { c }).collect();
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    cleaned.trim_start_matches('.').trim().to_string()
}

fn join_rel(folder: &str, name: &str) -> String {
    if folder.is_empty() { name.to_string() } else { format!("{folder}/{name}") }
}

/// Whether something else in the folder already has this name, ignoring case like the Mac does.
/// `except` is the entry being renamed, which may keep its own name in another case.
fn taken(dir: &Path, name: &str, except: Option<&Path>) -> bool {
    let Ok(entries) = fs::read_dir(dir) else { return false };
    entries.flatten().any(|e| e.file_name().to_string_lossy().to_lowercase() == name.to_lowercase() && except != Some(e.path().as_path()))
}

/// The first free name: "Untitled", then "Untitled 2" and so on.
fn free_name(dir: &Path, stem: &str, ext: &str) -> String {
    let mut n = 1;
    loop {
        let name = if n == 1 { format!("{stem}{ext}") } else { format!("{stem} {n}{ext}") };
        if !taken(dir, &name, None) {
            return name;
        }
        n += 1;
    }
}

/// Makes a new note in a folder ("" is the vault itself) and returns its path.
pub fn create_note(root: &Path, folder: &str, name: &str, content: &str) -> Result<String, String> {
    let dir = resolve(root, folder)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stem = clean_name(name);
    let file = free_name(&dir, if stem.is_empty() { "Untitled" } else { &stem }, ".md");
    let rel = join_rel(folder, &file);
    write(root, &rel, content)?;
    Ok(rel)
}

pub fn create_folder(root: &Path, parent: &str, name: &str) -> Result<String, String> {
    let dir = resolve(root, parent)?;
    let stem = clean_name(name);
    let folder = free_name(&dir, if stem.is_empty() { "New folder" } else { &stem }, "");
    fs::create_dir_all(dir.join(&folder)).map_err(|e| e.to_string())?;
    Ok(join_rel(parent, &folder))
}

/// The name without its folder and, for a note, without ".md".
pub fn stem(rel: &str) -> &str {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    if name.len() > 3 && name[name.len() - 3..].eq_ignore_ascii_case(".md") { &name[..name.len() - 3] } else { name }
}

fn parent_of(rel: &str) -> &str {
    rel.rfind('/').map_or("", |i| &rel[..i])
}

pub struct Renamed {
    pub path: String,
    /// Other notes whose links were pointed at the new name.
    pub updated: Vec<String>,
}

/// Renames a note or folder in place. A note keeps ".md"; links to it across the vault follow.
pub fn rename(root: &Path, rel: &str, new_name: &str, written: &mut dyn FnMut(String, String)) -> Result<Renamed, String> {
    let from = resolve(root, rel)?;
    let is_dir = from.is_dir();
    let name = clean_name(new_name);
    if name.is_empty() {
        return Err("A name can't be empty.".into());
    }
    let file = if is_dir { name.clone() } else { format!("{name}.md") };
    let parent = parent_of(rel);
    let to_rel = join_rel(parent, &file);
    if to_rel == rel {
        return Ok(Renamed { path: to_rel, updated: vec![] });
    }
    let to = resolve(root, &to_rel)?;
    if taken(from.parent().unwrap_or(root), &file, Some(&from)) {
        return Err(format!("There's already something called “{name}” here."));
    }
    fs::rename(&from, &to).map_err(|e| e.to_string())?;
    let updated = if is_dir { vec![] } else { relink(root, rel, &to_rel, written) };
    Ok(Renamed { path: to_rel, updated })
}

/// Moves a note or folder into another folder ("" for the vault itself).
pub fn move_into(root: &Path, rel: &str, folder: &str, written: &mut dyn FnMut(String, String)) -> Result<Renamed, String> {
    let from = resolve(root, rel)?;
    let name = rel.rsplit('/').next().unwrap_or(rel);
    if folder == rel || folder.starts_with(&format!("{rel}/")) {
        return Err("A folder can't go inside itself.".into());
    }
    let to_rel = join_rel(folder, name);
    if to_rel == rel {
        return Ok(Renamed { path: to_rel, updated: vec![] });
    }
    let dir = resolve(root, folder)?;
    if taken(&dir, name, None) {
        return Err(format!("There's already something called “{}” in there.", stem(name)));
    }
    fs::rename(&from, dir.join(name)).map_err(|e| e.to_string())?;
    // Only links written as paths need to change; [[Name]] still finds it.
    let updated = if from.is_dir() { vec![] } else { relink(root, rel, &to_rel, written) };
    Ok(Renamed { path: to_rel, updated })
}

/// Points `[[links]]` at a note's new name or path, across every note in the vault.
fn relink(root: &Path, old: &str, new: &str, written: &mut dyn FnMut(String, String)) -> Vec<String> {
    let old_stem = stem(old);
    let new_stem = stem(new);
    let old_path = &old[..old.len() - 3];
    let new_path = &new[..new.len() - 3];
    let mut updated = Vec::new();
    let Ok(index) = index(root) else { return updated };
    for note in index.notes {
        if !note.wikilinks.iter().any(|t| t.eq_ignore_ascii_case(old_stem) || t.eq_ignore_ascii_case(old_path)) {
            continue;
        }
        let Ok(content) = read(root, &note.path) else { continue };
        let mut out = String::with_capacity(content.len());
        let mut last = 0;
        for link in wikilinks(&content) {
            let replacement = if link.target.eq_ignore_ascii_case(old_path) && link.target.contains('/') {
                new_path
            } else if link.target.eq_ignore_ascii_case(old_stem) {
                new_stem
            } else {
                continue;
            };
            out.push_str(&content[last..link.start]);
            out.push_str(replacement);
            last = link.end;
        }
        out.push_str(&content[last..]);
        if out != content {
            if let Ok(body) = write(root, &note.path, &out) {
                written(note.path.clone(), body);
                updated.push(note.path);
            }
        }
    }
    updated
}

/// Full-text search, case-insensitive. Titles are matched on the page; this looks inside notes.
pub fn search(root: &Path, query: &str, limit: usize) -> Result<Vec<Hit>, String> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(vec![]);
    }
    let index = index(root)?;
    let mut hits = Vec::new();
    for note in index.notes {
        let Ok(content) = read(root, &note.path) else { continue };
        let body = &content[body_start(&content)..];
        let lower = body.to_lowercase();
        let count = lower.matches(&needle).count();
        if count == 0 {
            continue;
        }
        let line = body.lines().find(|l| l.to_lowercase().contains(&needle)).unwrap_or("");
        hits.push(Hit { path: note.path, snippet: snippet(line, &needle), count });
    }
    hits.sort_by(|a, b| b.count.cmp(&a.count).then(a.path.cmp(&b.path)));
    hits.truncate(limit);
    Ok(hits)
}

/// About 110 characters of the line, centred on the match.
fn snippet(line: &str, needle: &str) -> String {
    let line = line.trim().trim_start_matches(|c: char| matches!(c, '#' | '-' | '*' | '>' | ' '));
    let chars: Vec<char> = line.chars().collect();
    let lower: Vec<char> = line.to_lowercase().chars().collect();
    let at = if lower.len() == chars.len() {
        let needle: Vec<char> = needle.chars().collect();
        (0..chars.len()).find(|&i| lower[i..].starts_with(&needle)).unwrap_or(0)
    } else {
        0
    };
    let start = at.saturating_sub(40);
    let end = (start + 110).min(chars.len());
    let mut out: String = chars[start..end].iter().collect();
    if start > 0 {
        out = format!("…{}", out.trim_start());
    }
    if end < chars.len() {
        out = format!("{}…", out.trim_end());
    }
    out
}

/// Saves a pasted or dropped image next to the vault's other attachments and returns its path.
pub fn save_attachment(root: &Path, name: &str, bytes: &[u8]) -> Result<String, String> {
    let folder = "attachments";
    let dir = resolve(root, folder)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let (stem, ext) = match name.rfind('.') {
        Some(i) => (&name[..i], &name[i..]),
        None => (name, ".png"),
    };
    let file = free_name(&dir, &clean_name(stem), ext);
    fs::write(dir.join(&file), bytes).map_err(|e| e.to_string())?;
    Ok(join_rel(folder, &file))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_wikilinks_outside_code() {
        let text = "See [[Ideas]] and [[Work/Plan#Goals|the plan]].\n```\n[[Not a link]]\n```\n`[[nor this]]` [[ Spaced ]]\n";
        let targets: Vec<&str> = wikilinks(text).iter().map(|l| l.target).collect();
        assert_eq!(targets, ["Ideas", "Work/Plan", "Spaced"]);
    }

    #[test]
    fn resolves_markdown_links() {
        assert_eq!(markdown_links("[a](../Other%20note.md) [b](https://x.md) [c](same.md#top)", "Work/Deep"), ["Work/Other note.md", "Work/Deep/same.md"]);
    }

    #[test]
    fn refuses_paths_outside() {
        let root = Path::new("/vault");
        assert!(resolve(root, "../etc/passwd").is_err());
        assert!(resolve(root, "/etc/passwd").is_err());
        assert_eq!(resolve(root, "a/b.md").unwrap(), PathBuf::from("/vault/a/b.md"));
    }

    #[test]
    fn excerpt_skips_front_matter_and_headings() {
        assert_eq!(excerpt("---\ntags: [a]\n---\n# Title\n\n- **First** thing [[here]]\n"), "First thing here");
    }

    #[test]
    fn renames_and_relinks() {
        let root = std::env::temp_dir().join(format!("down-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("Work")).unwrap();
        fs::write(root.join("Work/Plan.md"), "plan\n").unwrap();
        fs::write(root.join("Index.md"), "[[Plan]] and [[plan#Goals|goals]] and [[Work/Plan]] and [[Other]]\n").unwrap();
        let mut seen = Vec::new();
        let renamed = rename(&root, "Work/Plan.md", "Roadmap", &mut |p, _| seen.push(p)).unwrap();
        assert_eq!(renamed.path, "Work/Roadmap.md");
        assert_eq!(fs::read_to_string(root.join("Index.md")).unwrap(), "[[Roadmap]] and [[Roadmap#Goals|goals]] and [[Work/Roadmap]] and [[Other]]\n");
        assert_eq!(seen, ["Index.md"]);
        let moved = move_into(&root, "Work/Roadmap.md", "", &mut |_, _| {}).unwrap();
        assert_eq!(moved.path, "Roadmap.md");
        assert_eq!(fs::read_to_string(root.join("Index.md")).unwrap(), "[[Roadmap]] and [[Roadmap#Goals|goals]] and [[Roadmap]] and [[Other]]\n");
        assert!(move_into(&root, "Work", "Work", &mut |_, _| {}).is_err());
        assert_eq!(create_note(&root, "", "Roadmap", "").unwrap(), "Roadmap 2.md");
        let _ = fs::remove_dir_all(&root);
    }
}
