import Foundation
import PencilKit
import UIKit

/// 手写旁挂文件的读写，格式见 docs/ink-sidecar-format.md：
/// `笔记.ink`（PKDrawing 二进制）+ `笔记.ink.png`（位图快照，供 Mac 端只读叠加）+ `笔记.ink.json`（快照位置）
enum InkStore {
    static func inkURL(for noteURL: URL) -> URL { sibling(noteURL, ext: "ink") }
    static func pngURL(for noteURL: URL) -> URL { sibling(noteURL, ext: "ink.png") }
    static func jsonURL(for noteURL: URL) -> URL { sibling(noteURL, ext: "ink.json") }

    private static func sibling(_ noteURL: URL, ext: String) -> URL {
        noteURL.deletingPathExtension().appendingPathExtension(ext)
    }

    static func load(for noteURL: URL) -> PKDrawing {
        guard let data = try? Data(contentsOf: inkURL(for: noteURL)),
              let drawing = try? PKDrawing(data: data) else { return PKDrawing() }
        return drawing
    }

    static func save(_ drawing: PKDrawing, for noteURL: URL, canvasWidth: CGFloat) {
        let fm = FileManager.default
        // 笔迹为空：删掉全部旁挂文件，不留空壳
        if drawing.strokes.isEmpty {
            for url in [inkURL(for: noteURL), pngURL(for: noteURL), jsonURL(for: noteURL)] {
                try? fm.removeItem(at: url)
            }
            return
        }
        let ink = inkURL(for: noteURL)
        if (try? Data(contentsOf: ink)) != drawing.dataRepresentation() {
            try? drawing.dataRepresentation().write(to: ink, options: .atomic)
        }
        // 位图快照 + 位置信息，Mac 端按 canvasWidth 等比缩放后叠加显示
        let bounds = drawing.bounds.insetBy(dx: -8, dy: -8)
        let image = drawing.image(from: bounds, scale: 2)
        if let png = image.pngData() {
            try? png.write(to: pngURL(for: noteURL), options: .atomic)
        }
        let meta: [String: Any] = [
            "version": 1,
            "canvasWidth": canvasWidth,
            "bounds": ["x": bounds.origin.x, "y": bounds.origin.y, "width": bounds.width, "height": bounds.height],
        ]
        if let data = try? JSONSerialization.data(withJSONObject: meta, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: jsonURL(for: noteURL), options: .atomic)
        }
    }
}
