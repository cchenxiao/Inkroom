import { Extension, Mark, Node, mergeAttributes } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
export const SegmentBlock = Node.create({
  name: 'segmentBlock',
  group: 'block',
  content: 'inline*',
  defining: true,
  addAttributes() {
    return { segmentId: { default: null }, pov: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'p[data-segment-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'p',
      mergeAttributes(HTMLAttributes, {
        'data-segment-id': HTMLAttributes.segmentId,
        'data-pov': HTMLAttributes.pov,
      }),
      0,
    ];
  },
});
export const EntityMention = Mark.create({
  name: 'entityMention',
  inclusive: false,
  addAttributes() {
    return { entityId: { default: null }, label: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'span[data-entity-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-entity-id': HTMLAttributes.entityId,
        class: 'entity-mention',
        title: HTMLAttributes.label,
      }),
      0,
    ];
  },
});
export const ForeshadowMark = Mark.create({
  name: 'foreshadow',
  inclusive: false,
  addAttributes() {
    return { id: { default: null }, state: { default: 'plant' } };
  },
  parseHTML() {
    return [{ tag: 'span[data-foreshadow]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-foreshadow': HTMLAttributes.state,
        class: `foreshadow-mark foreshadow-${HTMLAttributes.state}`,
      }),
      0,
    ];
  },
});
export const PovMark = Mark.create({
  name: 'pov',
  inclusive: false,
  addAttributes() {
    return { name: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'span[data-pov-name]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-pov-name': HTMLAttributes.name, class: 'pov-mark' }),
      0,
    ];
  },
});
export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  addAttributes() {
    return { id: { default: null }, text: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-comment-id': HTMLAttributes.id,
        class: 'comment-mark',
        title: HTMLAttributes.text,
      }),
      0,
    ];
  },
});
export interface AnnotationOptions {
  heat: number;
  heatmap: boolean;
  findings: { id: string; quote: string; severity: string }[];
}
export const manuscriptAnnotationsKey = new PluginKey<AnnotationOptions>('manuscript-annotations');
export const ManuscriptAnnotations = Extension.create<AnnotationOptions>({
  name: 'manuscriptAnnotations',
  addOptions() {
    return { heat: 0, heatmap: false, findings: [] };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<AnnotationOptions>({
        key: manuscriptAnnotationsKey,
        state: {
          init: () => options,
          apply: (tr, previous) => tr.getMeta(manuscriptAnnotationsKey) ?? previous,
        },
        props: {
          decorations(state) {
            const options = manuscriptAnnotationsKey.getState(state)!;
            const decorations: Decoration[] = [];
            const blocks: { from: number; text: string; offset: number }[] = [];
            let text = '';
            state.doc.descendants((node, pos) => {
              if (!node.isTextblock) return;
              if (blocks.length) text += '\n';
              // Hard breaks occupy one document position, just like their newline.
              const value = node.textBetween(0, node.content.size, '', '\n');
              blocks.push({ from: pos + 1, text: value, offset: text.length });
              text += value;
              if (value && options.heatmap && options.heat > 0.3)
                decorations.push(
                  Decoration.inline(pos + 1, pos + 1 + node.content.size, {
                    class: `ai-heat ${options.heat > 0.6 ? 'heat-high' : 'heat-low'}`,
                  }),
                );
            });
            for (const finding of options.findings) {
              if (!finding.quote) continue;
              const start = text.indexOf(finding.quote);
              if (start < 0) continue;
              const end = start + finding.quote.length;
              for (const block of blocks) {
                const from = Math.max(start, block.offset);
                const to = Math.min(end, block.offset + block.text.length);
                if (to > from)
                  decorations.push(
                    Decoration.inline(
                      block.from + from - block.offset,
                      block.from + to - block.offset,
                      {
                        'data-finding-id': finding.id,
                        class: `finding-mark finding-${finding.severity.toLowerCase()}`,
                      },
                    ),
                  );
              }
            }
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
