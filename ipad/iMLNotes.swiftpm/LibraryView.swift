import SwiftUI

/// 笔记库浏览：左侧文件夹 / 笔记列表，右侧编辑器（NavigationSplitView 在 iPad 上自动分栏）
struct LibraryView: View {
    @EnvironmentObject private var library: LibraryStore
    @State private var showPicker = false
    @State private var selection: NoteItem?

    var body: some View {
        NavigationSplitView {
            Group {
                if library.rootURL == nil {
                    ContentUnavailableView {
                        Label("还没有选择笔记库", systemImage: "books.vertical")
                    } description: {
                        Text("选一个文件夹作为笔记库。放在 iCloud Drive 里的文件夹可以和 Mac 端共用。")
                    } actions: {
                        Button("选择文件夹") { showPicker = true }
                            .buttonStyle(.borderedProminent)
                    }
                } else {
                    FolderListView(folder: library.rootURL!, selection: $selection)
                }
            }
            .navigationTitle(library.rootURL?.lastPathComponent ?? "iML Notes")
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    Button {
                        if let url = library.createNote() { selection = NoteItem(url: url, isDirectory: false) }
                    } label: { Image(systemName: "square.and.pencil") }
                    .disabled(library.rootURL == nil)
                    Button { showPicker = true } label: { Image(systemName: "folder.badge.gearshape") }
                }
            }
        } detail: {
            if let note = selection, !note.isDirectory {
                NoteEditorView(noteURL: note.url)
                    .id(note.url)
            } else {
                ContentUnavailableView("选择一篇笔记", systemImage: "doc.text")
            }
        }
        .sheet(isPresented: $showPicker) {
            FolderPicker { url in library.setRoot(url) }
        }
        .alert("出错了", isPresented: Binding(get: { library.errorMessage != nil }, set: { if !$0 { library.errorMessage = nil } })) {
            Button("好") { library.errorMessage = nil }
        } message: {
            Text(library.errorMessage ?? "")
        }
    }
}

/// 一个文件夹的内容；子文件夹用 NavigationLink 逐级进入
struct FolderListView: View {
    let folder: URL
    @Binding var selection: NoteItem?
    @State private var items: [NoteItem] = []

    var body: some View {
        List(items, selection: $selection) { item in
            if item.isDirectory {
                NavigationLink {
                    FolderListView(folder: item.url, selection: $selection)
                        .navigationTitle(item.name)
                } label: {
                    Label(item.name, systemImage: "folder")
                }
            } else {
                NavigationLink(value: item) {
                    Label(item.name, systemImage: "doc.text")
                }
            }
        }
        .listStyle(.sidebar)
        .refreshable { items = LibraryStore.list(folder) }
        .onAppear { items = LibraryStore.list(folder) }
    }
}
