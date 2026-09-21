//! iML 编辑器的 Tauri 壳。
//!
//! 这一层只做「界面自己做不了的事」：读写文件、监听文件夹、系统对话框之外的系统调用、本地图片协议、打印。
//! 逻辑（文件名怎么起、网页标题怎么解析、哪个安装包是这台电脑的）都留在前端的 TypeScript 里——那边有测试，
//! Electron 壳用的也是同一份。前端通过 `src/platform/tauriApi.ts` 把这些命令包成和 Electron preload 一样的 `window.api`。

use std::{
    collections::HashSet,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{mpsc, Mutex},
    time::{Duration, UNIX_EPOCH},
};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use percent_encoding::percent_decode_str;
use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{
    http::{header, Request as HttpRequest, Response as HttpResponse, StatusCode},
    ipc::{InvokeBody, Request as IpcRequest, Response as IpcResponse},
    AppHandle, Emitter, Manager, State,
};
use tauri_plugin_opener::OpenerExt;

const DOC_EXTS: [&str; 5] = ["md", "markdown", "mdown", "mkd", "txt"];
/// 和「iML 笔记」共用一个仓库：翻最近的发布，由前端按 lite-v 前缀认出自己的版本
const RELEASES_API: &str = "https://api.github.com/repos/imoling/iml-markdown-editor/releases?per_page=40";

#[derive(Default)]
struct AppState {
    /// 系统递进来（双击 .md、「打开方式」、命令行）、还没被界面取走的文件
    pending_open: Mutex<Vec<String>>,
    /// 这次运行里导出过的文件：状态栏提示上的「打开 / 在访达中显示」只认这里面的路径
    exported: Mutex<HashSet<PathBuf>>,
    /// 侧边栏里打开的那个文件夹的监听；换文件夹或关掉时把旧的丢掉
    watcher: Mutex<Option<RecommendedWatcher>>,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn is_openable_document(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| DOC_EXTS.contains(&e.to_ascii_lowercase().as_str()))
            .unwrap_or(false)
}

/// 把系统传入的文件交给界面。只走一条路：入队，再发一个不带参数的 open-file 提醒；界面在启动完成和收到提醒时都会来取
fn queue_open(app: &AppHandle, path: PathBuf) {
    if !is_openable_document(&path) {
        return;
    }
    if let Some(state) = app.try_state::<AppState>() {
        state.pending_open.lock().unwrap().push(path.to_string_lossy().into_owned());
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit("open-file", ());
}

/// 命令行参数里的文档；相对路径按给定的工作目录解析
fn documents_from_args(args: &[String], cwd: &Path) -> Vec<PathBuf> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| {
            let p = PathBuf::from(a);
            if p.is_absolute() { p } else { cwd.join(p) }
        })
        .filter(|p| is_openable_document(p))
        .collect()
}

// ── 文件 ─────────────────────────────────────────────────────────────────────

#[tauri::command]
fn fs_read_text(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(err)
}

#[tauri::command]
fn fs_write_text(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirEntry {
    name: String,
    path: String,
    is_directory: bool,
    /// 修改 / 创建时间（毫秒）：文件树可以按时间排序。拿不到就是 0
    mtime: f64,
    ctime: f64,
}

fn millis(t: std::io::Result<std::time::SystemTime>) -> f64 {
    t.ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

#[tauri::command]
fn fs_read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(&path).map_err(err)? {
        let Ok(entry) = entry else { continue };
        let full = entry.path();
        // 跟着符号链接走：链到文件夹的也当文件夹
        let meta = fs::metadata(&full).or_else(|_| entry.metadata());
        let (is_directory, mtime, ctime) = match meta {
            Ok(m) => {
                let mtime = millis(m.modified());
                let created = millis(m.created());
                (m.is_dir(), mtime, if created > 0.0 { created } else { mtime })
            }
            Err(_) => (false, 0.0, 0.0),
        };
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: full.to_string_lossy().into_owned(),
            is_directory,
            mtime,
            ctime,
        });
    }
    out.sort_by(|a, b| b.is_directory.cmp(&a.is_directory).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

#[tauri::command]
fn fs_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
fn fs_mkdir(path: String) -> Result<(), String> {
    if Path::new(&path).exists() {
        return Err("Target already exists".into());
    }
    fs::create_dir_all(&path).map_err(err)
}

#[tauri::command]
fn fs_rename(old_path: String, new_path: String) -> Result<(), String> {
    if Path::new(&new_path).exists() {
        return Err("Target already exists".into());
    }
    fs::rename(&old_path, &new_path).map_err(err)
}

#[tauri::command]
fn fs_copy(source_path: String, target_path: String) -> Result<(), String> {
    if Path::new(&target_path).exists() {
        return Err("Target already exists".into());
    }
    fs::copy(&source_path, &target_path).map(|_| ()).map_err(err)
}

/// 推入废纸篓 / 回收站；系统不给用（比如网络盘）才真删。返回是不是真删了
#[tauri::command]
fn fs_delete(path: String) -> Result<bool, String> {
    if trash::delete(&path).is_ok() {
        return Ok(false);
    }
    let p = Path::new(&path);
    if p.is_dir() { fs::remove_dir_all(p) } else { fs::remove_file(p) }.map_err(err)?;
    Ok(true)
}

/// 请求头里的值只能是 ASCII，路径和文件名由前端 encodeURIComponent 之后放进来
fn header_text(request: &IpcRequest<'_>, name: &str) -> Result<String, String> {
    let raw = request.headers().get(name).and_then(|v| v.to_str().ok()).ok_or_else(|| format!("missing header {name}"))?;
    percent_decode_str(raw).decode_utf8().map(|s| s.into_owned()).map_err(err)
}

fn raw_body<'a>(request: &'a IpcRequest<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes),
        InvokeBody::Json(_) => Err("expected a binary body".into()),
    }
}

/// 粘贴 / 拖入的图片：存进文档旁边的 assets/，重名就加序号。名字（x-name）已经由前端收拾干净了
#[tauri::command]
fn fs_save_asset(request: IpcRequest<'_>) -> Result<Value, String> {
    let dir = PathBuf::from(header_text(&request, "x-dir")?);
    let name = header_text(&request, "x-name")?;
    let bytes = raw_body(&request)?;
    if !dir.is_absolute() || name.is_empty() || name.contains(['/', '\\']) {
        return Err("图片的保存位置不对".into());
    }
    let assets = dir.join("assets");
    fs::create_dir_all(&assets).map_err(err)?;
    let (stem, ext) = match name.rfind('.') {
        Some(dot) if dot > 0 => (&name[..dot], &name[dot..]),
        _ => (name.as_str(), ""),
    };
    let mut unique = name.clone();
    let mut counter = 1;
    while assets.join(&unique).exists() {
        unique = format!("{stem}-{counter}{ext}");
        counter += 1;
    }
    fs::write(assets.join(&unique), bytes).map_err(err)?;
    Ok(json!({ "path": format!("assets/{unique}"), "bytes": bytes.len() }))
}

// ── 导出 ─────────────────────────────────────────────────────────────────────

fn remember_exported(state: &State<'_, AppState>, path: &str) {
    state.exported.lock().unwrap().insert(PathBuf::from(path));
}

/// 导出的文本文件（单文件 HTML）。存到哪由前端的保存对话框问过了
#[tauri::command]
fn export_write_text(state: State<'_, AppState>, path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(err)?;
    remember_exported(&state, &path);
    Ok(())
}

/// 导出的二进制文件（Word 文档）：内容走请求体，路径在 x-path 头里
#[tauri::command]
fn export_write_bytes(state: State<'_, AppState>, request: IpcRequest<'_>) -> Result<(), String> {
    let path = header_text(&request, "x-path")?;
    fs::write(&path, raw_body(&request)?).map_err(err)?;
    remember_exported(&state, &path);
    Ok(())
}

/// 界面不能拿任意路径来让系统打开：只认这次运行里导出过的文件
fn exported_path(state: &State<'_, AppState>, path: &str) -> Option<PathBuf> {
    let p = PathBuf::from(path);
    state.exported.lock().unwrap().contains(&p).then_some(p)
}

#[tauri::command]
fn export_open(app: AppHandle, state: State<'_, AppState>, path: String) -> bool {
    exported_path(&state, &path)
        .map(|p| app.opener().open_path(p.to_string_lossy(), None::<&str>).is_ok())
        .unwrap_or(false)
}

#[tauri::command]
fn export_reveal(app: AppHandle, state: State<'_, AppState>, path: String) -> bool {
    exported_path(&state, &path).map(|p| app.opener().reveal_item_in_dir(p).is_ok()).unwrap_or(false)
}

/// 打印当前窗口。前端先把要导出的文档摆好（打印样式里只露出它），再叫这个；「存储为 PDF」在系统的打印面板里
#[tauri::command]
fn print_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(err)
}

// ── 系统 ─────────────────────────────────────────────────────────────────────

/// 文件树里的「在访达 / 资源管理器中显示」
#[tauri::command]
fn reveal_in_folder(app: AppHandle, path: String) -> Result<(), String> {
    app.opener().reveal_item_in_dir(path).map_err(err)
}

/// 交给系统浏览器 / 邮件客户端。只放行这三种协议：文档里的一个链接不该能调起别的程序
#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    let lower = url.trim_start().to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")) {
        return Err("unsupported url".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(err)
}

/// 冒烟测试（只在调试构建里）：系统的保存对话框自动化点不了，IML_SMOKE_EXPORT_DIR 指了目录就直接存进去。正式包里永远是 None
#[tauri::command]
fn smoke_export_dir() -> Option<String> {
    if cfg!(debug_assertions) { std::env::var("IML_SMOKE_EXPORT_DIR").ok() } else { None }
}

#[tauri::command]
fn consume_pending_open_files(state: State<'_, AppState>) -> Vec<String> {
    std::mem::take(&mut *state.pending_open.lock().unwrap())
}

// ── 设置 ─────────────────────────────────────────────────────────────────────

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(err)?;
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join("app-settings.json"))
}

fn read_settings_file(app: &AppHandle) -> Map<String, Value> {
    settings_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

#[tauri::command]
fn settings_get(app: AppHandle) -> Value {
    let mut settings = Map::new();
    settings.insert("appearanceMode".into(), json!("light"));
    settings.insert("startupBehavior".into(), json!("restore"));
    settings.insert("autoSave".into(), json!(false));
    settings.extend(read_settings_file(&app));
    Value::Object(settings)
}

/// 合并写入：各个设置入口只传自己管的字段，不能把别人的字段冲掉
#[tauri::command]
fn settings_save(app: AppHandle, settings: Value) -> Result<(), String> {
    let mut merged = read_settings_file(&app);
    if let Some(patch) = settings.as_object() {
        merged.extend(patch.clone());
    }
    let text = serde_json::to_string_pretty(&Value::Object(merged)).map_err(err)?;
    fs::write(settings_path(&app)?, text).map_err(err)
}

// ── 文件夹监听 ───────────────────────────────────────────────────────────────

/// 外部（同步盘 / 其他编辑器）改动 → 通知界面刷新树、重载未修改的标签页。传 null = 停止监听
#[tauri::command]
fn folder_watch(app: AppHandle, state: State<'_, AppState>, path: Option<String>) -> bool {
    let mut slot = state.watcher.lock().unwrap();
    *slot = None; // 丢掉旧的：它的发送端跟着没了，下面那个攒事件的线程自己会退出
    let Some(root) = path.map(PathBuf::from).filter(|p| p.is_dir()) else { return false };

    let (tx, rx) = mpsc::channel::<PathBuf>();
    let watch_root = root.clone();
    let mut watcher = match notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        for p in event.paths {
            // 隐藏文件（.DS_Store、同步盘的临时文件等）不触发
            let hidden = p.strip_prefix(&watch_root).map(|rel| rel.components().any(|c| c.as_os_str().to_string_lossy().starts_with('.'))).unwrap_or(false);
            if !hidden {
                let _ = tx.send(p);
            }
        }
    }) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("[folder:watch] failed: {e}");
            return false;
        }
    };
    if let Err(e) = watcher.watch(&root, RecursiveMode::Recursive) {
        eprintln!("[folder:watch] failed: {e}");
        return false;
    }
    *slot = Some(watcher);

    // 一次保存往往带来好几个事件：攒 400 毫秒没有新的了，再一起告诉界面
    std::thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            let mut changed: HashSet<PathBuf> = HashSet::from([first]);
            while let Ok(more) = rx.recv_timeout(Duration::from_millis(400)) {
                changed.insert(more);
            }
            let paths: Vec<String> = changed.into_iter().map(|p| p.to_string_lossy().into_owned()).collect();
            let _ = app.emit("folder:changed", paths);
        }
    });
    true
}

// ── 联网（只有两件事：取网页标题、查更新）────────────────────────────────────

fn http_agent(timeout: Duration) -> Result<ureq::Agent, String> {
    let tls = native_tls::TlsConnector::new().map_err(err)?;
    Ok(ureq::AgentBuilder::new().tls_connector(std::sync::Arc::new(tls)).timeout(timeout).redirects(5).build())
}

/// 粘贴网址时取网页标题用：只认 http(s)，5 秒超时，最多读 512KB，读到 </title> 就停。
/// 返回原始字节和 Content-Type——编码怎么判、标题怎么抠，前端有现成的（还带测试）
#[tauri::command]
async fn fetch_page_head(url: String) -> Result<Value, String> {
    let lower = url.trim_start().to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("unsupported url".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let resp = http_agent(Duration::from_secs(5))?
            .get(&url)
            .set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")
            .set("Accept", "text/html,application/xhtml+xml")
            .set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
            .call()
            .map_err(err)?;
        let content_type = resp.header("content-type").unwrap_or("").to_string();
        let lower_type = content_type.to_ascii_lowercase();
        if !lower_type.is_empty() && !lower_type.contains("html") && !lower_type.contains("xml") {
            return Err("not a web page".into());
        }
        let mut reader = resp.into_reader();
        let mut body: Vec<u8> = Vec::new();
        let mut chunk = [0u8; 16 * 1024];
        while body.len() < 512 * 1024 {
            let n = reader.read(&mut chunk).map_err(err)?;
            if n == 0 {
                break;
            }
            body.extend_from_slice(&chunk[..n]);
            if body.windows(8).any(|w| w.eq_ignore_ascii_case(b"</title>")) {
                break;
            }
        }
        Ok(json!({ "contentType": content_type, "body": body }))
    })
    .await
    .map_err(err)?
}

/// 取一张网上的图片（导出长图时要把图片内联进去）：只认 http(s)，15 秒超时，最多 12MB，回来的得是图片。
/// 内容原样走响应体；是什么格式由前端按文件头认
#[tauri::command]
async fn fetch_image(url: String) -> Result<IpcResponse, String> {
    const MAX: usize = 12 * 1024 * 1024;
    let lower = url.trim_start().to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("unsupported url".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let resp = http_agent(Duration::from_secs(15))?.get(&url).set("Accept", "image/*,*/*;q=0.5").call().map_err(err)?;
        let content_type = resp.header("content-type").unwrap_or("").to_ascii_lowercase();
        if !content_type.is_empty() && !content_type.starts_with("image/") && !content_type.starts_with("application/octet-stream") {
            return Err("not an image".into());
        }
        let mut body = Vec::new();
        resp.into_reader().take(MAX as u64 + 1).read_to_end(&mut body).map_err(err)?;
        if body.len() > MAX {
            return Err("image too large".into());
        }
        Ok(IpcResponse::new(body))
    })
    .await
    .map_err(err)?
}

/// 查更新：地址是写死的，界面只能拿到这一个接口的内容
#[tauri::command]
async fn fetch_releases() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        http_agent(Duration::from_secs(15))?
            .get(RELEASES_API)
            .set("Accept", "application/vnd.github.v3+json")
            .set("User-Agent", "iML-Editor")
            .call()
            .map_err(err)?
            .into_string()
            .map_err(err)
    })
    .await
    .map_err(err)?
}

// ── 图片压缩 ─────────────────────────────────────────────────────────────────

/// macOS 的系统 WebView（Safari 内核）不能把画布编码成 WebP，前端发现编不出来时把原图交到这里。
/// 和前端那条路同一套规矩：等比缩到上限以内、不放大，有损 WebP。
#[tauri::command]
fn image_to_webp(request: IpcRequest<'_>) -> Result<IpcResponse, String> {
    let number = |name: &str, fallback: f32| request.headers().get(name).and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<f32>().ok()).unwrap_or(fallback);
    let max_w = number("x-max-width", 2560.0);
    let max_h = number("x-max-height", 12000.0);
    let quality = number("x-quality", 90.0).clamp(1.0, 100.0);

    let img = image::load_from_memory(raw_body(&request)?).map_err(err)?;
    let (w, h) = (img.width() as f32, img.height() as f32);
    let scale = (max_w / w).min(max_h / h).min(1.0);
    let img = if scale < 1.0 {
        img.resize_exact(((w * scale).round() as u32).max(1), ((h * scale).round() as u32).max(1), image::imageops::FilterType::CatmullRom)
    } else {
        img
    };
    let rgba = img.to_rgba8();
    let encoded = webp::Encoder::from_rgba(rgba.as_raw(), rgba.width(), rgba.height()).encode(quality);
    Ok(IpcResponse::new(encoded.to_vec()))
}

// ── 本地图片协议 iml-asset:// ────────────────────────────────────────────────

fn asset_mime(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    // 只放行图片、音频、视频的扩展名：文档里的一条地址不该能读任意本地文件
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "tif" | "tiff" => "image/tiff",
        "webm" => "audio/webm",
        "m4a" => "audio/mp4",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "ogv" => "video/ogg",
        _ => return None,
    })
}

/// bytes=START-END / bytes=START- / bytes=-SUFFIX → 闭区间 [start, end]；不合法或超出文件返回 None（回 416）
fn parse_range(header: &str, size: u64) -> Option<(u64, u64)> {
    let spec = header.trim().strip_prefix("bytes=")?;
    let (a, b) = spec.split_once('-')?;
    if size == 0 || (a.is_empty() && b.is_empty()) {
        return None;
    }
    let (start, end) = if a.is_empty() {
        (size.saturating_sub(b.parse::<u64>().ok()?), size - 1)
    } else {
        let start = a.parse::<u64>().ok()?;
        let end = if b.is_empty() { size - 1 } else { b.parse::<u64>().ok()?.min(size - 1) };
        (start, end)
    };
    (start <= end && start < size).then_some((start, end))
}

fn plain(status: StatusCode, text: &'static str) -> HttpResponse<Vec<u8>> {
    HttpResponse::builder().status(status).header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*").body(text.as_bytes().to_vec()).unwrap()
}

/// iml-asset://localhost/<encodeURIComponent(绝对路径)>（Windows 上是 http://iml-asset.localhost/…）→ 本地的图片 / 音频 / 视频。
/// 播放器拖进度会发 Range 请求，必须老老实实回 206 + Content-Range
fn serve_asset(request: &HttpRequest<Vec<u8>>) -> HttpResponse<Vec<u8>> {
    let encoded = request.uri().path().trim_start_matches('/');
    let Ok(decoded) = percent_decode_str(encoded).decode_utf8() else { return plain(StatusCode::BAD_REQUEST, "bad path") };
    let path = PathBuf::from(decoded.as_ref());
    if !path.is_absolute() {
        return plain(StatusCode::FORBIDDEN, "forbidden");
    }
    let Some(mime) = asset_mime(&path) else { return plain(StatusCode::FORBIDDEN, "forbidden") };
    let Ok(mut file) = fs::File::open(&path) else { return plain(StatusCode::NOT_FOUND, "not found") };
    let size = file.metadata().map(|m| m.len()).unwrap_or(0);

    let base = HttpResponse::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-cache")
        // 导出 Word / HTML 时界面用 fetch 取图片字节，来源和这个协议不同源
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");

    let range = request.headers().get(header::RANGE).and_then(|v| v.to_str().ok());
    match range {
        None => {
            let mut body = Vec::with_capacity(size as usize);
            if file.read_to_end(&mut body).is_err() {
                return plain(StatusCode::NOT_FOUND, "not found");
            }
            base.status(StatusCode::OK).header(header::CONTENT_LENGTH, body.len()).body(body).unwrap()
        }
        Some(spec) => {
            let Some((start, end)) = parse_range(spec, size) else {
                return HttpResponse::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(header::CONTENT_RANGE, format!("bytes */{size}"))
                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .body(Vec::new())
                    .unwrap();
            };
            // 一次最多给 4MB：播放器会接着要下一段，不必把几百 MB 的录音整个读进内存
            let end = end.min(start + 4 * 1024 * 1024 - 1);
            let mut body = vec![0u8; (end - start + 1) as usize];
            if file.seek(SeekFrom::Start(start)).is_err() || file.read_exact(&mut body).is_err() {
                return plain(StatusCode::NOT_FOUND, "not found");
            }
            base.status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_LENGTH, body.len())
                .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"))
                .body(body)
                .unwrap()
        }
    }
}

// ── macOS 菜单栏 ─────────────────────────────────────────────────────────────
// Windows 上界面自己画菜单（标题栏里那一排），不需要原生菜单。
// macOS 必须有：没有「编辑」菜单里那几项系统动作，⌘C / ⌘V / ⌘Z 在 WebView 里根本不工作。

#[cfg(target_os = "macos")]
fn setup_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

    let name = app.package_info().name.clone();
    let name = if name.is_empty() { "iML 编辑器".to_string() } else { name };
    let item = |id: &str, text: &str, accel: Option<&str>| {
        let b = MenuItemBuilder::with_id(id, text);
        match accel { Some(a) => b.accelerator(a), None => b }.build(app)
    };

    let app_menu = SubmenuBuilder::new(app, &name)
        .item(&item("dialog:about", &format!("关于 {name}"), None)?)
        .separator()
        .item(&item("dialog:settings", "设置…", Some("Cmd+,"))?)
        .separator()
        .item(&PredefinedMenuItem::services(app, Some("服务"))?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some(&format!("隐藏 {name}")))?)
        .item(&PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?)
        .item(&PredefinedMenuItem::show_all(app, Some("全部显示"))?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some(&format!("退出 {name}")))?)
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "文件")
        .item(&item("menu:new-file", "新建文档", Some("Cmd+N"))?)
        .item(&item("menu:open-file", "打开文件…", Some("Cmd+O"))?)
        .item(&item("menu:open-folder", "打开文件夹…", Some("Cmd+Shift+O"))?)
        .separator()
        .item(&item("menu:save", "保存", Some("Cmd+S"))?)
        .separator()
        .item(&item("export:pdf", "打印 / 导出为 PDF…", Some("Cmd+P"))?)
        .item(&item("export:html", "导出为 HTML…", Some("Cmd+Shift+E"))?)
        .item(&item("export:docx", "导出为 Word…", None)?)
        .item(&item("export:image", "导出为长图…", None)?)
        .separator()
        // 标签页是界面管的，但 ⌘W 得在这里占住：否则系统会拿它去关窗口
        .item(&item("menu:close-tab", "关闭标签页", Some("Cmd+W"))?)
        .item(&item("menu:close-other-tabs", "关闭其他标签页", Some("Alt+Cmd+W"))?)
        .item(&item("menu:close-saved-tabs", "关闭已保存的标签页", None)?)
        .item(&item("menu:close-all-tabs", "关闭全部标签页", None)?)
        .item(&item("menu:reopen-tab", "重开刚关的标签页", Some("Cmd+Shift+T"))?)
        .separator()
        .item(&item("window:close", "关闭窗口", Some("Cmd+Shift+W"))?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "编辑")
        .item(&PredefinedMenuItem::undo(app, Some("撤销"))?)
        .item(&PredefinedMenuItem::redo(app, Some("重做"))?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some("剪切"))?)
        .item(&PredefinedMenuItem::copy(app, Some("复制"))?)
        .item(&PredefinedMenuItem::paste(app, Some("粘贴"))?)
        .item(&PredefinedMenuItem::select_all(app, Some("全选"))?)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "视图").item(&PredefinedMenuItem::fullscreen(app, Some("切换全屏"))?).build()?;

    let window_menu = SubmenuBuilder::new(app, "窗口")
        .item(&PredefinedMenuItem::minimize(app, Some("最小化"))?)
        .item(&PredefinedMenuItem::maximize(app, Some("缩放"))?)
        .build()?;

    let help_menu = SubmenuBuilder::new(app, "帮助").item(&item("dialog:shortcuts", "快捷键说明", Some("Cmd+/"))?).build()?;

    let menu = MenuBuilder::new(app).items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu, &help_menu]).build()?;
    app.set_menu(menu)?;

    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        // 菜单项的 id 就是要发给界面的事件：menu:xxx 原样发；dialog:xxx、export:xxx 把后半截当参数
        if let Some(dialog) = id.strip_prefix("dialog:") {
            let _ = app.emit("dialog:open", dialog);
        } else if let Some(kind) = id.strip_prefix("export:") {
            let _ = app.emit("menu:export", kind);
        } else if id == "window:close" {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.close();
            }
        } else if id.starts_with("menu:") {
            let _ = app.emit(id, ());
        }
    });
    Ok(())
}

// ── 启动 ─────────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // 必须第一个注册。Windows / Linux：再双击一个 .md，交给已经开着的那个窗口，而不是再起一个进程
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let docs = documents_from_args(&args, Path::new(&cwd));
            if docs.is_empty() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            for doc in docs {
                queue_open(app, doc);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .register_asynchronous_uri_scheme_protocol("iml-asset", |_ctx, request, responder| {
            // 读盘放到别的线程去：一篇文档里几十张图不该卡住界面
            std::thread::spawn(move || responder.respond(serve_asset(&request)));
        })
        .invoke_handler(tauri::generate_handler![
            fs_read_text,
            fs_write_text,
            fs_read_dir,
            fs_exists,
            fs_mkdir,
            fs_rename,
            fs_copy,
            fs_delete,
            fs_save_asset,
            export_write_text,
            export_write_bytes,
            export_open,
            export_reveal,
            print_window,
            reveal_in_folder,
            open_external,
            consume_pending_open_files,
            smoke_export_dir,
            settings_get,
            settings_save,
            folder_watch,
            fetch_page_head,
            fetch_image,
            fetch_releases,
            image_to_webp,
        ])
        .setup(|app| {
            // Windows / Linux：双击 .md 启动时，路径在命令行参数里（macOS 走下面的 Opened 事件）
            let args: Vec<String> = std::env::args().collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            let state = app.state::<AppState>();
            for doc in documents_from_args(&args, &cwd) {
                state.pending_open.lock().unwrap().push(doc.to_string_lossy().into_owned());
            }

            // 冒烟测试（只在调试构建里）：IML_SMOKE_OPEN 启动时打开一个文件；
            // IML_SMOKE_SCRIPT_FILE 是一段 JS，页面起来 6 秒后在里面执行——系统 WebView 没有 CDP，无人值守的检查靠它
            #[cfg(debug_assertions)]
            {
                if let Ok(open) = std::env::var("IML_SMOKE_OPEN") {
                    if is_openable_document(Path::new(&open)) {
                        state.pending_open.lock().unwrap().push(open);
                    }
                }
                if let Ok(script_file) = std::env::var("IML_SMOKE_SCRIPT_FILE") {
                    let handle = app.handle().clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_secs(6));
                        if let (Ok(script), Some(window)) = (fs::read_to_string(&script_file), handle.get_webview_window("main")) {
                            let _ = window.eval(&script);
                        }
                    });
                }
            }

            #[cfg(target_os = "macos")]
            setup_menu(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building iML 编辑器");

    app.run(|_app, _event| {
        // macOS：访达里双击 .md、「打开方式」都从这里进来（可能早于窗口就绪，所以先入队）
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = &_event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    queue_open(_app, path);
                }
            }
        }
    });
}
