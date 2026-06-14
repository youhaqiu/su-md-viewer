use base64::{engine::general_purpose, Engine as _};
use std::collections::HashMap;
use std::fs;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager, State, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};

// 应用级状态：待打开文件的路由信息。
#[derive(Default)]
struct AppState {
    // 主窗口冷启动时的待打开文件（事件可能早于前端就绪）
    pending: Mutex<Option<String>>,
    // 各文档窗口 label -> 文件路径
    files: Mutex<HashMap<String, String>>,
    // 主窗口是否已被占用（决定首个文件进主窗口、后续开新窗口）
    main_used: AtomicBool,
    // 文档窗口自增编号
    next_id: AtomicUsize,
}

// 读取指定路径的文本文件，返回内容。失败时把错误信息回传给前端。
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("无法读取文件: {e}"))
}

// 读取本地图片并编码成 data URL，前端直接当 img.src 用，绕开资源协议/scope。
#[tauri::command]
fn read_image_data_url(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("无法读取图片: {e}"))?;
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    };
    let b64 = general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

// 前端启动时调用：取走当前窗口要打开的文件（文档窗口查 files 表，主窗口查 pending）。
#[tauri::command]
fn get_initial_file(window: tauri::WebviewWindow, state: State<AppState>) -> Option<String> {
    let label = window.label().to_string();
    if label == "main" {
        return state.pending.lock().unwrap().take();
    }
    state.files.lock().unwrap().remove(&label)
}

// Windows / Linux：文件通过命令行参数传入。从 argv 里挑出存在的文件并打开。
fn open_from_args(app: &tauri::AppHandle, argv: &[String], cwd: Option<&str>) {
    for a in argv.iter().skip(1) {
        if a.starts_with('-') {
            continue; // 跳过 flag / macOS 的 -psn_ 参数
        }
        let mut p = std::path::PathBuf::from(a);
        if p.is_relative() {
            if let Some(c) = cwd {
                p = std::path::Path::new(c).join(&p);
            }
        }
        if p.is_file() {
            open_path_in_window(app, p.to_string_lossy().to_string());
        }
    }
}

// 把一个文件路由到窗口：首个进主窗口，之后每个开独立新窗口。
fn open_path_in_window(app: &tauri::AppHandle, path: String) {
    let state = app.state::<AppState>();
    if !state.main_used.swap(true, Ordering::SeqCst) {
        // 首个文件 → 主窗口。冷启动靠 pending，热启动靠 emit。
        *state.pending.lock().unwrap() = Some(path.clone());
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.emit("open-file", path);
        }
    } else {
        // 之后的文件 → 新窗口
        let id = state.next_id.fetch_add(1, Ordering::SeqCst);
        let label = format!("doc-{id}");
        state
            .files
            .lock()
            .unwrap()
            .insert(label.clone(), path);
        let _ = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
            .title("73·素")
            .inner_size(900.0, 720.0)
            .title_bar_style(TitleBarStyle::Overlay)
            .hidden_title(true)
            .build();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        // 单实例：Windows/Linux 下双击文件会新起进程，这里把它的 argv 转给已运行实例
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            open_from_args(app, &argv, Some(&cwd));
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            read_file,
            read_image_data_url,
            get_initial_file
        ])
        .setup(|app| {
            // 顶部原生菜单：File > 打开…（⌘O）
            let open_item = MenuItemBuilder::with_id("open", "打开…")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;

            let app_menu = SubmenuBuilder::new(app, "73·素")
                .about(None)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&open_item)
                .separator()
                .close_window()
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .copy()
                .select_all()
                .build()?;

            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .separator()
                .close_window()
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[&app_menu, &file_menu, &edit_menu, &window_menu])
                .build()?;

            app.set_menu(menu)?;

            // 冷启动时若由命令行/文件关联带入文件（Windows/Linux），在此打开。
            // macOS 走 Opened 事件，argv 里没有文件，这里自然不会误触发。
            let cwd = std::env::current_dir().ok();
            let args: Vec<String> = std::env::args().collect();
            open_from_args(
                app.handle(),
                &args,
                cwd.as_deref().and_then(|p| p.to_str()),
            );
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "open" {
                // 只对当前聚焦的窗口生效，避免每个窗口都弹一次文件框
                if let Some(w) = app
                    .webview_windows()
                    .values()
                    .find(|w| w.is_focused().unwrap_or(false))
                {
                    let _ = w.emit("menu-open", ());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOS：双击 .md / 用本应用打开文件时，系统会发来 Opened 事件
            if let tauri::RunEvent::Opened { urls } = event {
                for path in urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().to_string())
                {
                    open_path_in_window(app, path);
                }
            }
        });
}
