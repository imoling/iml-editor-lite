import React from 'react';

export interface PromptDialogProps {
  title: string;
  fields: { name: string; label: string; defaultValue: string; type?: string }[];
  onConfirm: (values: Record<string, string>) => void;
  onCancel: () => void;
}

/** 通用的小型输入对话框（插入表格 / 链接） */
export const PromptDialog: React.FC<PromptDialogProps> = ({ title, fields, onConfirm, onCancel }) => {
  const [values, setValues] = React.useState<Record<string, string>>(
    fields.reduce((acc, f) => ({ ...acc, [f.name]: f.defaultValue }), {})
  );

  return (
    <div className="modal-backdrop modal-backdrop--light">
      <div className="modal-card modal-card--dialog">
        <h3 className="modal-title modal-title--dialog">{title}</h3>
        <div className="col gap-12">
          {fields.map((field) => (
            <div key={field.name} className="col gap-4">
              <label className="text-sm text-secondary">{field.label}</label>
              <input
                type={field.type || 'text'}
                autoFocus={fields[0].name === field.name}
                value={values[field.name]}
                onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onConfirm(values);
                  if (e.key === 'Escape') onCancel();
                }}
                className="field-input field-input--sm"
              />
            </div>
          ))}
        </div>
        <div className="dialog-buttons">
          <button onClick={onCancel} className="btn btn-ghost btn-sm btn-block">取消</button>
          <button onClick={() => onConfirm(values)} className="btn btn-primary btn-sm btn-block">确定</button>
        </div>
      </div>
    </div>
  );
};
