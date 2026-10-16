import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { expect, it } from 'vitest';
import { contentFor } from './SegmentEditor';
import { SegmentBlock, PovMark, ManuscriptAnnotations } from './extensions';
import type { Segment } from '@/types/domain';

it('round-trips authored paragraphs and preserves a finding spanning a paragraph boundary', () => {
  const text = '沈砚合上书。\n“你读过？”\n\n他没有回答。';
  const segment = { id: 's1', pov: '沈砚' } as Segment;
  const editor = new Editor({
    extensions: [
      StarterKit.configure({
        paragraph: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
      }),
      SegmentBlock,
      PovMark,
      ManuscriptAnnotations.configure({
        findings: [{ id: 'f1', quote: '合上书。\n“你读过？”', severity: 'P1' }],
      }),
    ],
    content: contentFor(segment, text),
  });
  expect(editor.state.doc.childCount).toBe(4);
  expect(editor.getText({ blockSeparator: '\n' })).toBe(text);
  expect(editor.view.dom.querySelectorAll('[data-finding-id="f1"]')).toHaveLength(2);
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  editor.commands.insertContent('灯灭了。');
  expect(editor.getText({ blockSeparator: '\n' })).toBe(text + '灯灭了。');
  editor.destroy();
});
