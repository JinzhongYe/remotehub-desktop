use tauri::plugin::{Builder, TauriPlugin};
#[cfg(target_os = "ios")]
use tauri::{plugin::PluginHandle, Manager};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_remotehub_mobile);

#[cfg(target_os = "ios")]
pub struct NativePlugin(pub PluginHandle<tauri::Wry>);

pub fn init() -> TauriPlugin<tauri::Wry> {
    Builder::new("remotehub-mobile")
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            _app.manage(NativePlugin(_api.register_ios_plugin(init_plugin_remotehub_mobile)?));
            Ok(())
        })
        .build()
}
