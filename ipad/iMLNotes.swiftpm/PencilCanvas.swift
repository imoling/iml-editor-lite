import SwiftUI
import PencilKit

/// PencilKit 画布：启用时显示系统工具栏，笔迹变化回调给上层做保存
struct PencilCanvas: UIViewRepresentable {
    @Binding var drawing: PKDrawing
    var isEnabled: Bool
    var onChange: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIView(context: Context) -> PKCanvasView {
        let canvas = PKCanvasView()
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        canvas.drawingPolicy = .anyInput
        canvas.isScrollEnabled = false
        canvas.delegate = context.coordinator
        canvas.drawing = drawing
        return canvas
    }

    func updateUIView(_ canvas: PKCanvasView, context: Context) {
        if canvas.drawing != drawing { canvas.drawing = drawing }
        canvas.isUserInteractionEnabled = isEnabled
        let picker = context.coordinator.toolPicker
        if isEnabled {
            picker.setVisible(true, forFirstResponder: canvas)
            picker.addObserver(canvas)
            canvas.becomeFirstResponder()
        } else {
            picker.setVisible(false, forFirstResponder: canvas)
            canvas.resignFirstResponder()
        }
    }

    final class Coordinator: NSObject, PKCanvasViewDelegate {
        let parent: PencilCanvas
        let toolPicker = PKToolPicker()
        init(parent: PencilCanvas) { self.parent = parent }

        func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
            parent.drawing = canvasView.drawing
            parent.onChange()
        }
    }
}
