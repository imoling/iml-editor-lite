import SwiftUI
import PencilKit

/// 单篇笔记：正文（源码编辑 / 预览）+ 手写覆盖层
struct NoteEditorView: View {
    let noteURL: URL

    @State private var text: String = ""
    @State private var drawing = PKDrawing()
    @State private var mode: Mode = .edit
    @State private var inkEnabled = false
    @State private var loadError: String?
    @State private var saveTask: Task<Void, Never>?

    enum Mode: String, CaseIterable { case edit = "编辑", preview = "预览" }

    /// 与 docs/ink-sidecar-format.md 约定的画布宽度
    private let canvasWidth: CGFloat = 820

    var body: some View {
        ZStack {
            ScrollView {
                Group {
                    if mode == .edit {
                        TextEditor(text: $text)
                            .font(.system(.body, design: .default))
                            .scrollDisabled(true)
                            .frame(minHeight: UIScreen.main.bounds.height)
                            .onChange(of: text) { _, _ in scheduleSave() }
                    } else {
                        MarkdownPreview(text: text)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(24)
                .frame(width: canvasWidth, alignment: .topLeading)
                // 手写层叠在正文之上，与正文同宽同坐标系；关闭时不拦截触摸
                .overlay(alignment: .topLeading) {
                    PencilCanvas(drawing: $drawing, isEnabled: inkEnabled) { scheduleSave() }
                        .allowsHitTesting(inkEnabled)
                }
            }
            .frame(maxWidth: .infinity)
        }
        .navigationTitle(noteURL.deletingPathExtension().lastPathComponent)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Picker("模式", selection: $mode) {
                    ForEach(Mode.allCases, id: \.self) { Text($0.rawValue) }
                }
                .pickerStyle(.segmented)
                Toggle(isOn: $inkEnabled) { Image(systemName: "pencil.tip.crop.circle") }
                    .toggleStyle(.button)
                    .help("手写")
            }
        }
        .task { load() }
        .onDisappear { saveNow() }
        .alert("无法打开笔记", isPresented: Binding(get: { loadError != nil }, set: { if !$0 { loadError = nil } })) {
            Button("好") {}
        } message: { Text(loadError ?? "") }
    }

    private func load() {
        do {
            text = try NoteIO.read(noteURL)
        } catch {
            loadError = error.localizedDescription
        }
        drawing = InkStore.load(for: noteURL)
    }

    /// 停止输入 800ms 后落盘；离开页面时立即落盘
    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(800))
            if Task.isCancelled { return }
            await MainActor.run { saveNow() }
        }
    }

    private func saveNow() {
        saveTask?.cancel()
        do {
            let onDisk = (try? NoteIO.read(noteURL)) ?? ""
            if onDisk != text { try NoteIO.write(text, to: noteURL) }
        } catch {
            loadError = "保存失败：\(error.localizedDescription)"
        }
        InkStore.save(drawing, for: noteURL, canvasWidth: canvasWidth)
    }
}

/// v0 预览：按行渲染，标题 / 列表 / 引用做最基本的样式，行内语法交给系统 Markdown 解析
struct MarkdownPreview: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(text.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in
                lineView(line)
            }
        }
    }

    @ViewBuilder
    private func lineView(_ raw: String) -> some View {
        let line = raw.trimmingCharacters(in: .whitespaces)
        if line.hasPrefix("### ") {
            inline(String(line.dropFirst(4))).font(.title3.bold())
        } else if line.hasPrefix("## ") {
            inline(String(line.dropFirst(3))).font(.title2.bold())
        } else if line.hasPrefix("# ") {
            inline(String(line.dropFirst(2))).font(.title.bold())
        } else if line.hasPrefix("- ") || line.hasPrefix("* ") {
            HStack(alignment: .top, spacing: 8) { Text("•"); inline(String(line.dropFirst(2))) }
        } else if line.hasPrefix("> ") {
            inline(String(line.dropFirst(2)))
                .padding(.leading, 12)
                .overlay(alignment: .leading) { Rectangle().frame(width: 3).foregroundStyle(.tint) }
        } else if line.isEmpty {
            Spacer().frame(height: 4)
        } else {
            inline(line)
        }
    }

    private func inline(_ s: String) -> Text {
        if let attributed = try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) {
            return Text(attributed)
        }
        return Text(s)
    }
}
