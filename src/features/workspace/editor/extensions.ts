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
export const ManuscriptAnnotations = Extension.create<AnnotationOptions>({
  name: 'manuscriptAnnotations',
  addOptions() {
    return { heat: 0, heatmap: false, findings: [] };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        key: new PluginKey('manuscript-annotations'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isTextblock || !node.textContent) return;
              const contentStart = pos + 1;
              if (options.heatmap && options.heat > 0.3)
                decorations.push(
                  Decoration.inline(contentStart, contentStart + node.content.size, {
                    class: `ai-heat ${options.heat > 0.6 ? 'heat-high' : 'heat-low'}`,
                  }),
                );
              for (const finding of options.findings) {
                const start = node.textContent.indexOf(finding.quote);
                if (start >= 0 && finding.quote)
                  decorations.push(
                    Decoration.inline(
                      contentStart + start,
                      contentStart + start + finding.quote.length,
                      {
                        'data-finding-id': finding.id,
                        class: `finding-mark finding-${finding.severity.toLowerCase()}`,
                      },
                    ),
                  );
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
