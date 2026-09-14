import Foundation
import SwiftUI
import UniformTypeIdentifiers

/// 笔记库里的一个条目（文件或文件夹）
struct NoteItem: Identifiable, Hashable {
    let url: URL
    let isDirectory: Bool
    var id: String { url.path }
    var name: String {
        isDirectory ? url.lastPathComponent : url.deletingPathExtension().lastPathComponent
    }
}

/// 笔记库：一个由用户选定的文件夹。选定后保存 security-scoped bookmark，下次启动直接恢复访问权限。
@MainActor
final class LibraryStore: ObservableObject {
    @Published private(set) var rootURL: URL?
    @Published private(set) var items: [NoteItem] = []
    @Published var errorMessage: String?

    private static let bookmarkKey = "iml.library.bookmark"
    private static let noteExtensions: Set<String> = ["md", "markdown", "mdown", "mkd", "txt"]

    init() {
        restoreBookmark()
    }

    // MARK: - 选择 / 恢复笔记库

    func setRoot(_ url: URL) {
        guard url.startAccessingSecurityScopedResource() else {
            errorMessage = "无法访问所选文件夹"
            return
        }
        do {
            let bookmark = try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
            UserDefaults.standard.set(bookmark, forKey: Self.bookmarkKey)
        } catch {
            errorMessage = "保存文件夹访问权限失败：\(error.localizedDescription)"
        }
        rootURL?.stopAccessingSecurityScopedResource()
        rootURL = url
        reload()
    }

    private func restoreBookmark() {
        guard let data = UserDefaults.standard.data(forKey: Self.bookmarkKey) else { return }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale),
              url.startAccessingSecurityScopedResource() else { return }
        rootURL = url
        if stale, let refreshed = try? url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil) {
            UserDefaults.standard.set(refreshed, forKey: Self.bookmarkKey)
        }
        reload()
    }

    // MARK: - 目录列表

    func reload(folder: URL? = nil) {
        guard let root = rootURL else { items = []; return }
        let dir = folder ?? root
        items = Self.list(dir)
    }

    /// 列出一个目录：文件夹在前，隐藏文件与非笔记文件不显示（与 Mac 端侧边栏规则一致）
    static func list(_ dir: URL) -> [NoteItem] {
        let keys: [URLResourceKey] = [.isDirectoryKey, .isHiddenKey]
        guard let urls = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles]) else {
            return []
        }
        let entries: [NoteItem] = urls.compactMap { url in
            let values = try? url.resourceValues(forKeys: Set(keys))
            let isDir = values?.isDirectory ?? false
            if !isDir && !noteExtensions.contains(url.pathExtension.lowercased()) { return nil }
            return NoteItem(url: url, isDirectory: isDir)
        }
        return entries.sorted {
            if $0.isDirectory != $1.isDirectory { return $0.isDirectory }
            return $0.name.localizedStandardCompare($1.name) == .orderedAscending
        }
    }

    // MARK: - 新建

    func createNote(in folder: URL? = nil) -> URL? {
        guard let dir = folder ?? rootURL else { return nil }
        var url = dir.appendingPathComponent("未命名笔记.md")
        var n = 2
        while FileManager.default.fileExists(atPath: url.path) {
            url = dir.appendingPathComponent("未命名笔记 \(n).md")
            n += 1
        }
        do {
            try NoteIO.write("", to: url)
            reload(folder: folder)
            return url
        } catch {
            errorMessage = "新建笔记失败：\(error.localizedDescription)"
            return nil
        }
    }
}

/// 正文读写统一走 NSFileCoordinator，iCloud / 同步盘下不会读到半个文件
enum NoteIO {
    static func read(_ url: URL) throws -> String {
        var coordError: NSError?
        var result: Result<String, Error> = .failure(CocoaError(.fileReadUnknown))
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordError) { readURL in
            result = Result { try String(contentsOf: readURL, encoding: .utf8) }
        }
        if let coordError { throw coordError }
        return try result.get()
    }

    static func write(_ text: String, to url: URL) throws {
        var coordError: NSError?
        var writeError: Error?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordError) { writeURL in
            do { try text.data(using: .utf8)?.write(to: writeURL, options: .atomic) } catch { writeError = error }
        }
        if let coordError { throw coordError }
        if let writeError { throw writeError }
    }
}
