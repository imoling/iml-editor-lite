import React from 'react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  onConfirm: () => void; // Save
  onDiscard: () => void; // Don't Save
  onCancel: () => void;  // Cancel
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ title, message, onConfirm, onDiscard, onCancel }) => (
  <div className="modal-backdrop">
    <div className="modal-card modal-card--dialog confirm-dialog">
      <h3 className="modal-title modal-title--sm">{title}</h3>
      <p className="confirm-dialog__message">{message}</p>
      <div className="col gap-8 mt-12">
        <button onClick={onConfirm} className="btn btn-gradient btn-sm clickable">保存并开启新旅程</button>
        <div className="row gap-8">
          <button onClick={onDiscard} className="btn btn-surface btn-sm btn-block confirm-dialog__discard clickable">不保存</button>
          <button onClick={onCancel} className="btn btn-surface btn-sm btn-block clickable">取消</button>
        </div>
      </div>
    </div>
  </div>
);
