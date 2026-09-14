import SwiftUI

/// iML Notes for iPad —— v0
/// 与 Mac 端共用同一个笔记库文件夹（推荐 iCloud Drive/iML Notes）：
/// 浏览 Markdown 笔记、编辑正文、用 Apple Pencil 在正文上手写，手写按 docs/ink-sidecar-format.md 存为旁挂文件。
@main
struct iMLNotesApp: App {
    @StateObject private var library = LibraryStore()

    var body: some Scene {
        WindowGroup {
            LibraryView()
                .environmentObject(library)
        }
    }
}
