import React from 'react';

interface Props {
  /** 上面已经有一个大按钮（转写的开始键）时不用再放图标 */
  icon?: React.ReactNode;
  title: string;
  lead?: string;
  /** 两三条要点，每条一个小图标：比一段话好扫读 */
  points?: { icon: React.ReactNode; text: string }[];
  children?: React.ReactNode;
}

/** 侧边栏功能页的空状态：这是什么、凭什么放心用、从哪开始 */
export const PanelIntro: React.FC<Props> = ({ icon, title, lead, points, children }) => (
  <div className={`panel-intro ${icon ? '' : 'panel-intro--plain'}`}>
    {icon && <div className="panel-intro__badge">{icon}</div>}
    <div className="panel-intro__title">{title}</div>
    {lead && <p className="panel-intro__lead">{lead}</p>}
    {points && (
      <ul className="panel-intro__points">
        {points.map((p, i) => <li key={i}><span className="panel-intro__point-icon">{p.icon}</span><span>{p.text}</span></li>)}
      </ul>
    )}
    {children}
  </div>
);
