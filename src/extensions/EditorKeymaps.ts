import { Extension } from '@tiptap/core';

/**
 * 覆盖 StarterKit 里与应用级快捷键冲突的默认绑定：
 * - ⌘E 留给「切换编辑模式」，行内代码改为 ⌘`
 * - ⇧⌘S 留给「另存为」，删除线改为 ⇧⌘X
 * 返回 true 即吞掉编辑器内的默认行为，窗口级监听仍会收到事件。
 */
export const ShortcutOverrides = Extension.create({
  name: 'shortcutOverrides',
  priority: 1001,
  addKeyboardShortcuts() {
    return {
      'Mod-e': () => true,
      'Mod-`': () => this.editor.commands.toggleCode(),
      'Mod-Shift-s': () => true,
      'Mod-Shift-x': () => this.editor.commands.toggleStrike(),
    };
  },
});

export const CustomHeadingEnter = Extension.create({
  name: 'customHeadingEnter',
  priority: 1000, // Highest priority to ensure it runs before StarterKit's Heading/ListItem
  addKeyboardShortcuts() {
    const handleHeadingSplit = (editor: any, isMod: boolean) => {
      const { state } = editor;
      const { selection } = state;
      const { $from, empty } = selection;

      if (!empty) return false;

      const parentNode = $from.parent;
      if (parentNode.type.name !== 'heading') return false;

      // 如果用户在空的 heading 里按键盘，放行
      if (parentNode.textContent.trim() === '') return false;

      const grandParent = $from.node(-1);
      if (!grandParent || (grandParent.type.name !== 'listItem' && grandParent.type.name !== 'taskItem')) return false;

      const level = parentNode.attrs.level;
      
      // Execute splitListItem
      const success = editor.chain().splitListItem(grandParent.type.name).run();
      
      if (success) {
        // 如果是 Cmd+Enter，将新产生的段落强行转换为刚才的同级标题
        if (isMod) {
          editor.chain().setNode('heading', { level }).run();
          console.log('[CustomHeadingEnter] Cmd+Enter triggered: spawned same-level heading');
        } else {
          // 如果是普通的 Enter，我们不仅要劈开，还要强制它跳出列表（剥离），成为一干二净的纯文本！
          editor.chain().liftListItem(grandParent.type.name).run();
          console.log('[CustomHeadingEnter] Normal Enter triggered: extracted to pure paragraph outside list');
        }
        return true;
      }

      return false;
    };

    return {
      'Mod-Enter': ({ editor }) => handleHeadingSplit(editor, true),
      Enter: ({ editor }) => handleHeadingSplit(editor, false)
    };
  }
});
