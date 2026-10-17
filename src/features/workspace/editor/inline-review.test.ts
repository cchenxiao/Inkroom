import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { expect, it } from 'vitest';
import { InlineReview, inlineReviewKey, reviewAnchor } from './inline-review';

it('places the UI after quoted evidence, without altering text, undo or serialized content', () => {
  const editor = new Editor({
    extensions: [StarterKit, InlineReview],
    content: '<p>开场。</p><p>线索😀有矛盾。</p><p>后续正文。</p>',
  });
  const before = editor.getJSON();
  const host = document.createElement('div');
  host.className = 'test-review';
  host.textContent = '这是一条审查意见';
  host.contentEditable = 'false';
  editor.view.dispatch(
    editor.state.tr.setMeta(inlineReviewKey, { id: 'f1', quote: '线索😀有矛盾。', host }),
  );
  expect(host.previousElementSibling?.textContent).toBe('线索😀有矛盾。');
  expect(host.nextElementSibling?.textContent).toBe('后续正文。');
  expect(editor.getJSON()).toEqual(before);
  expect(editor.getText()).not.toContain('审查意见');
  expect(editor.getHTML()).not.toContain('审查意见');
  expect(editor.can().undo()).toBe(false);
  expect(reviewAnchor(editor.state.doc, '不存在的引文')).toBeNull();
  editor.view.dispatch(
    editor.state.tr.setMeta(inlineReviewKey, { id: 'f2', quote: '开场。\n线索😀有矛盾。', host }),
  );
  expect(host.previousElementSibling?.textContent).toBe('线索😀有矛盾。');
  editor.view.dispatch(editor.state.tr.setMeta(inlineReviewKey, null));
  expect(editor.view.dom.querySelector('.test-review')).toBeNull();
  expect(editor.getJSON()).toEqual(before);
  editor.destroy();
});
