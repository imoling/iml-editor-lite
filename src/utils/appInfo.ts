/**
 * 应用的名字与出处：界面上所有要写名字的地方都从这里取。
 * 改名一共四处：这里、electron/main.ts 的 APP_NAME、package.json 的 build.productName 与 nsis.shortcutName、index.html 的 <title>。
 * 数据目录（iML Editor）和安装包文件名（iML-Editor-Lite-…）是钉死的英文，不跟着显示名变
 */
export const APP_NAME = 'iML 编辑器';
export const APP_TAGLINE = '纯粹的 Markdown 编辑器';
export const REPO_URL = 'https://github.com/imoling/iml-markdown-editor';
export const RELEASES_URL = `${REPO_URL}/releases`;
