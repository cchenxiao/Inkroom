import { useEffect, useMemo, useRef } from 'react';
import { BubbleMenu, EditorContent, useEditor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  MessageSquare,
  Sparkles,
  BookmarkPlus,
  BookmarkCheck,
  BookOpen,
  MessageCircleWarning,
} from 'lucide-react';
import type { Bible, Finding, Segment } from '@/types/domain';
import { workspaceMessages as m } from '@/shared/lib/messages-workspace';
import {
  CommentMark,
  EntityMention,
  ForeshadowMark,
  ManuscriptAnnotations,
  PovMark,
  SegmentBlock,
} from './extensions';
export type SelectionAction = 'comment' | 'instruct' | 'plant' | 'resolve' | 'lie' | 'bible';
export interface SelectedText {
  segmentId: string;
  quote: string;
  action: SelectionAction;
}
function contentFor(segment: Segment, text: string, bible?: Bible): JSONContent {
  const ranges: {
    from: number;
    to: number;
    mark: { type: string; attrs: Record<string, unknown> };
  }[] = [];
  const add = (quote: string, mark: { type: string; attrs: Record<string, unknown> }) => {
    if (!quote) return;
    let start = text.indexOf(quote);
    while (start >= 0) {
      ranges.push({ from: start, to: start + quote.length, mark });
      start = text.indexOf(quote, start + quote.length);
    }
  };
  add(segment.pov, { type: 'pov', attrs: { name: segment.pov } });
  bible?.characters
    .filter(
      (c) => segment.entitiesMentioned.includes(c.id) || segment.charactersPresent.includes(c.id),
    )
    .forEach((c) =>
      add(c.name, {
        type: 'entityMention',
        attrs: {
          entityId: c.id,
          label: `${c.name} · ${c.role}\n${c.description}\n${m.characterWant}：${c.want}`,
        },
      }),
    );
  segment.comments?.forEach((c) =>
    add(c.quote, { type: 'comment', attrs: { id: c.id, text: c.text } }),
  );
  bible?.foreshadows
    .filter((f) => segment.foreshadowIds.includes(f.id))
    .forEach((f) =>
      add(text.includes(f.payload) ? f.payload : text.slice(0, 12), {
        type: 'foreshadow',
        attrs: { id: f.id, state: f.status === 'closed' ? 'resolve' : 'plant' },
      }),
    );
  const boundaries = [...new Set([0, text.length, ...ranges.flatMap((r) => [r.from, r.to])])].sort(
    (a, b) => a - b,
  );
  const content: JSONContent[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const from = boundaries[i],
      to = boundaries[i + 1];
    if (to > from)
      content.push({
        type: 'text',
        text: text.slice(from, to),
        marks: ranges.filter((r) => r.from <= from && r.to >= to).map((r) => r.mark),
      });
  }
  return {
    type: 'doc',
    content: [
      { type: 'segmentBlock', attrs: { segmentId: segment.id, pov: segment.pov }, content },
    ],
  };
}
export function SegmentEditor({
  segment,
  text,
  findings,
  bible,
  editable,
  heatmap,
  onChange,
  onFocus,
  onSelection,
  onFinding,
}: {
  segment: Segment;
  text: string;
  findings: Finding[];
  bible?: Bible;
  editable: boolean;
  heatmap: boolean;
  onChange: (id: string, text: string) => void;
  onFocus: (id: string) => void;
  onSelection: (selection: SelectedText) => void;
  onFinding: (id: string) => void;
}) {
  const annotationRevision = JSON.stringify([bible, segment.comments]);
  const annotationRevisionRef = useRef(annotationRevision);
  const handlers = useRef({ onChange, onFocus, onSelection, onFinding });
  handlers.current = { onChange, onFocus, onSelection, onFinding };
  const annotationFindings = JSON.stringify(
    findings
      .filter((f) => f.status === 'open')
      .map(({ id, quote, severity }) => ({ id, quote, severity })),
  );
  const heat = segment.styleStats.aiTaste;
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        paragraph: false,
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      SegmentBlock,
      EntityMention,
      ForeshadowMark,
      PovMark,
      CommentMark,
      ManuscriptAnnotations.configure({
        heat,
        heatmap,
        findings: JSON.parse(annotationFindings) as Finding[],
      }),
    ],
    [heat, heatmap, annotationFindings],
  );
  const editor = useEditor(
    {
      extensions,
      content: contentFor(segment, text, bible),
      editable,
      editorProps: {
        attributes: {
          'aria-label': `${m.editor} ${segment.order}`,
          'data-testid': `editor-${segment.id}`,
          spellcheck: 'false',
        },
        handleClick(_view, _pos, event) {
          const element = event.target as HTMLElement;
          const id = element.closest('[data-finding-id]')?.getAttribute('data-finding-id');
          if (id) handlers.current.onFinding(id);
          return false;
        },
      },
      onFocus: () => handlers.current.onFocus(segment.id),
      onUpdate: ({ editor }) =>
        handlers.current.onChange(segment.id, editor.getText({ blockSeparator: '\n' })),
    },
    [extensions],
  );
  useEffect(() => {
    editor?.setEditable(editable, false);
  }, [editable, editor]);
  useEffect(() => {
    if (
      editor &&
      (editor.getText({ blockSeparator: '\n' }) !== text ||
        annotationRevisionRef.current !== annotationRevision) &&
      !editor.isFocused
    ) {
      editor.commands.setContent(contentFor(segment, text, bible), false);
      annotationRevisionRef.current = annotationRevision;
    }
  }, [text, editor, bible, segment, annotationRevision]);
  const select = (action: SelectionAction) => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const quote = editor.state.doc.textBetween(from, to, ' ');
    if (quote.trim()) handlers.current.onSelection({ segmentId: segment.id, quote, action });
  };
  const actions = [
    ['comment', MessageSquare, m.comment],
    ['instruct', Sparkles, m.instruct],
    ['plant', BookmarkPlus, m.plant],
    ['resolve', BookmarkCheck, m.resolve],
    ['lie', MessageCircleWarning, m.lie],
    ['bible', BookOpen, m.bible],
  ] as const;
  return (
    <div className="segment-editor">
      <EditorContent editor={editor} />
      <div className="bubble-menu-mount">
        {editor && (
          <BubbleMenu
            editor={editor}
            shouldShow={({ editor: currentEditor }) =>
              currentEditor.isEditable && !currentEditor.state.selection.empty
            }
            tippyOptions={{ duration: 120, placement: 'top', maxWidth: 'none' }}
          >
            <div className="selection-menu" role="toolbar" aria-label={m.selection}>
              {actions.map(([action, Icon, label]) => (
                <button
                  key={action}
                  aria-label={label}
                  title={label}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(action)}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </BubbleMenu>
        )}
      </div>
    </div>
  );
}
