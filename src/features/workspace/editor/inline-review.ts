import { Extension } from '@tiptap/react';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface InlineReviewAnchor {
  id: string;
  quote: string;
  host: HTMLElement;
}
export const inlineReviewKey = new PluginKey<InlineReviewAnchor | null>('inline-review');

/** Anchor after the visual paragraph containing the end of the exact quoted evidence. */
export function reviewAnchor(doc: Node, quote: string) {
  const blocks: { offset: number; end: number; after: number }[] = [];
  let text = '';
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    if (blocks.length) text += '\n';
    const offset = text.length;
    text += node.textBetween(0, node.content.size, '', '\n');
    blocks.push({ offset, end: text.length, after: pos + node.nodeSize });
  });
  const from = quote ? text.indexOf(quote) : -1;
  if (from < 0) return null;
  const end = from + quote.length;
  return blocks.find((b) => b.offset < end && b.end >= end)?.after ?? null;
}

/** UI-only widget: it never becomes manuscript content or enters undo/save/export. */
export const InlineReview = Extension.create({
  name: 'inlineReview',
  addProseMirrorPlugins() {
    return [
      new Plugin<InlineReviewAnchor | null>({
        key: inlineReviewKey,
        state: {
          init: () => null,
          apply: (tr, previous) =>
            tr.getMeta(inlineReviewKey) === undefined ? previous : tr.getMeta(inlineReviewKey),
        },
        props: {
          decorations(state) {
            const anchor = inlineReviewKey.getState(state);
            if (!anchor) return DecorationSet.empty;
            const at = reviewAnchor(state.doc, anchor.quote);
            return DecorationSet.create(state.doc, [
              Decoration.widget(at ?? 0, anchor.host, {
                key: anchor.id,
                side: 1,
                ignoreSelection: true,
                stopEvent: () => true,
              }),
            ]);
          },
        },
      }),
    ];
  },
});
