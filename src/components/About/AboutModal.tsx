import React from 'react';
import { X } from 'lucide-react';
import logo from '../../assets/logo.png';
import { formatVersion } from '../../utils/version';
import { APP_NAME, APP_TAGLINE, REPO_URL } from '../../utils/appInfo';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const isStandalone = new URLSearchParams(window.location.search).get('window') === 'about';
  const isMac = window.api.app.platform === 'darwin';
  const open = (url: string) => window.api.shell.openExternal(url);

  return (
    <div className={isStandalone ? 'standalone about-standalone' : 'modal-backdrop'} onClick={onClose}>
      {isStandalone && <div className="standalone-drag" />}
      <div className={isStandalone ? 'about-card about-card--standalone' : 'modal-card about-card'} onClick={(e) => e.stopPropagation()}>
        <div className="about-logo"><img src={logo} alt="iML Logo" /></div>
        <h1 className="about-name">{APP_NAME}</h1>
        <p className="about-version">Version {formatVersion(window.api.appVersion)}</p>
        <p className="about-slogan">{APP_TAGLINE}</p>

        <div className="about-info">
          <div className="about-info__row"><span>Logic &amp; Design</span><span className="about-link" onClick={() => open('mailto:imoling.cn@gmail.com')}>imoling.cn@gmail.com</span></div>
          <div className="about-info__row"><span>Architected by</span><span className="about-info__value">Antigravity AI</span></div>
          <div className="about-info__row"><span>发布日期</span><span className="about-info__value">2026年9月</span></div>
          <div className="about-info__row"><span>GitHub</span><span className="about-link" onClick={() => open(REPO_URL)}>View Repository</span></div>
        </div>

        <p className="about-footer">
          &copy; 2026 iML Studio. 保留所有权利。<br />
          打开、写、保存。需要笔记库与本机智能，请用「iML 笔记」
        </p>

        {(!isStandalone || !isMac) && (
          <button onClick={onClose} className="modal-close"><X size={20} /></button>
        )}
      </div>
    </div>
  );
};

export default AboutModal;
