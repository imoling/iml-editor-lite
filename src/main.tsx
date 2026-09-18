import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AboutModal from './components/About/AboutModal';
import ShortcutsModal from './components/Help/ShortcutsModal';
import ModelConfigModal from './components/AI/ModelConfigModal';
import { ImageConfigModal } from './components/AI/ImageConfigModal';
import { SettingsModal } from './components/Settings/SettingsModal';
import './styles/index.css';
import './styles/ui.css';

const windowParam = new URLSearchParams(window.location.search).get('window');

// 每个独立窗口用自己的标题：否则 Dock 右键菜单 / 调度中心里会出现好几个同名的「iML Markdown Editor」
const WINDOW_TITLES: Record<string, string> = {
  about: '关于',
  shortcuts: '快捷键',
  'ai-config': '写作助手',
  'image-config': 'AI 配图',
  settings: '全局设置',
};
if (windowParam && WINDOW_TITLES[windowParam]) document.title = `${WINDOW_TITLES[windowParam]} — iML Markdown Editor`;

/** 独立窗口（?window=xxx）各自渲染一个组件；主窗口渲染 App */
function renderWindow(): React.ReactNode {
  switch (windowParam) {
    case 'about': return <AboutModal isOpen onClose={() => window.close()} />;
    case 'shortcuts': return <ShortcutsModal isOpen onClose={() => window.close()} />;
    case 'ai-config': return <ModelConfigModal isOpen onClose={() => window.close()} />;
    case 'image-config': return <ImageConfigModal onClose={() => window.close()} />;
    case 'settings': return <SettingsModal />;
    default: return null;
  }
}

const standalone = renderWindow();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {standalone ? <div className="standalone-root">{standalone}</div> : <App />}
  </React.StrictMode>
);
