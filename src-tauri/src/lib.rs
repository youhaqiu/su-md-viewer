use base64::{engine::general_purpose, Engine as _};
use std::collections::HashMap;
use std::fs;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;

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
    fs::read_to_string(&path).map_err(|e| format!("{e}"))
}

// 把编辑后的内容写回指定路径（UTF-8）。失败时把错误信息回传给前端。
#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| format!("{e}"))
}

// 读取本地图片并编码成 data URL，前端直接当 img.src 用，绕开资源协议/scope。
#[tauri::command]
fn read_image_data_url(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("{e}"))?;
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

// 按语言构建顶部菜单（zh=中文，否则英文）。
// 关键：macOS 预置项（关于/隐藏/退出/拷贝…）若用便捷方法会跟随「系统」语言，
// 导致切到另一种语言时菜单中英混杂；这里一律用 PredefinedMenuItem 显式传本地化文案，
// 让整份菜单都跟应用内的中/EN 切换走。
fn build_app_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    zh: bool,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::PredefinedMenuItem as P;

    let (open_l, file_t, edit_t, window_t) = if zh {
        ("打开…", "文件", "编辑", "窗口")
    } else {
        ("Open…", "File", "Edit", "Window")
    };
    let (about_l, services_l, hide_l, hide_others_l, show_all_l, quit_l) = if zh {
        ("关于 73·素", "服务", "隐藏 73·素", "隐藏其他", "全部显示", "退出 73·素")
    } else {
        (
            "About 73·素",
            "Services",
            "Hide 73·素",
            "Hide Others",
            "Show All",
            "Quit 73·素",
        )
    };
    let (undo_l, redo_l, cut_l, copy_l, paste_l, select_all_l) = if zh {
        ("撤销", "重做", "剪切", "拷贝", "粘贴", "全选")
    } else {
        ("Undo", "Redo", "Cut", "Copy", "Paste", "Select All")
    };
    let (minimize_l, close_l) = if zh {
        ("最小化", "关闭窗口")
    } else {
        ("Minimize", "Close Window")
    };

    let open_item = MenuItemBuilder::with_id("open", open_l)
        .accelerator("CmdOrCtrl+O")
        .build(app)?;

    let app_menu = SubmenuBuilder::new(app, "73·素") // 品牌名不翻译
        .item(&P::about(app, Some(about_l), None)?)
        .separator()
        .item(&P::services(app, Some(services_l))?)
        .separator()
        .item(&P::hide(app, Some(hide_l))?)
        .item(&P::hide_others(app, Some(hide_others_l))?)
        .item(&P::show_all(app, Some(show_all_l))?)
        .separator()
        .item(&P::quit(app, Some(quit_l))?)
        .build()?;

    let file_menu = SubmenuBuilder::new(app, file_t)
        .item(&open_item)
        .separator()
        .item(&P::close_window(app, Some(close_l))?)
        .build()?;

    // 编辑模式下需要完整的编辑动作（撤销/重做/剪切/粘贴），这里一并补上
    let edit_menu = SubmenuBuilder::new(app, edit_t)
        .item(&P::undo(app, Some(undo_l))?)
        .item(&P::redo(app, Some(redo_l))?)
        .separator()
        .item(&P::cut(app, Some(cut_l))?)
        .item(&P::copy(app, Some(copy_l))?)
        .item(&P::paste(app, Some(paste_l))?)
        .item(&P::select_all(app, Some(select_all_l))?)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, window_t)
        .item(&P::minimize(app, Some(minimize_l))?)
        .separator()
        .item(&P::close_window(app, Some(close_l))?)
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &window_menu])
        .build()
}

// 前端切换语言时调用：在主线程上按新语言重建并替换菜单。
#[tauri::command]
fn set_locale_menu(app: tauri::AppHandle, lang: String) {
    let zh = lang.to_lowercase().starts_with("zh");
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Ok(menu) = build_app_menu(&handle, zh) {
            let _ = handle.set_menu(menu);
        }
    });
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
        let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
            .title("73·素")
            .inner_size(900.0, 720.0);
        // 标题栏覆盖样式 + 隐藏原生标题为 macOS 专有 API（其他平台用默认标题栏）
        #[cfg(target_os = "macos")]
        let builder = builder
            .title_bar_style(TitleBarStyle::Overlay)
            .hidden_title(true);
        let _ = builder.build();
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
            write_file,
            read_image_data_url,
            get_initial_file,
            set_locale_menu
        ])
        .setup(|app| {
            // 顶部原生菜单：默认按系统语言；前端就绪后会调 set_locale_menu 同步到实际语言
            let zh = sys_locale::get_locale()
                .map(|l| l.to_lowercase().starts_with("zh"))
                .unwrap_or(false);
            let menu = build_app_menu(app.handle(), zh)?;
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
        .run(|_app, _event| {
            // macOS：双击 .md / 用本应用打开文件时，系统会发来 Opened 事件。
            // Opened 变体仅在 macOS 存在，Windows/Linux 走单实例插件的 argv 路径。
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                for path in urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().to_string())
                {
                    open_path_in_window(_app, path);
                }
            }
        });
}
