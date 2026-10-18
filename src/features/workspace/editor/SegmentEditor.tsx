import { InlineReview, inlineReviewKey, reviewAnchor } from './inline-review';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BubbleMenu, EditorContent, useEditor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  MessageSquare,
  Pencil,
  RotateCcw,
  ShieldCheck,
  PenLine,
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
  manuscriptAnnotationsKey,
  PovMark,
  SegmentBlock,
} from './extensions';
export type SelectionAction =
  'comment' | 'instruct' | 'plant' | 'resolve' | 'lie' | 'bible' | 'edit' | 'rewrite' | 'review';
export interface SelectedText {
  segmentId: string;
  quote: string;
  action: SelectionAction;
  version?: number;
}
export function contentFor(segment: Segment, text: string, bible?: Bible): JSONContent {
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
  // A Beat is a versioned unit, not a single visual paragraph. Preserve every
  // authored newline so loading and saving never silently reformats the text.
  let offset = 0;
  const content = text.split('\n').map((paragraph) => {
    const end = offset + paragraph.length;
    const cuts = [offset, ...boundaries.filter((p) => p > offset && p < end), end];
    const inline: JSONContent[] = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const from = cuts[i],
        to = cuts[i + 1];
      if (to > from)
        inline.push({
          type: 'text',
          text: text.slice(from, to),
          marks: ranges.filter((r) => r.from <= from && r.to >= to).map((r) => r.mark),
        });
    }
    offset = end + 1;
    return {
      type: 'segmentBlock',
      attrs: { segmentId: segment.id, pov: segment.pov },
      content: inline,
    };
  });
  return { type: 'doc', content };
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
  availableActions,
  review,
  editRequest,
}: {
  editRequest?: { quote: string; requestId: number };
  review?: { id: string; quote: string; content: ReactNode; keepVisibleOnClose?: boolean };
  availableActions?: SelectionAction[];
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
  const [reviewHost] = useState(() => {
    const host = document.createElement('div');
    host.className = 'inline-review-host';
    host.contentEditable = 'false';
    return host;
  });
  const [reviewLocated, setReviewLocated] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; quote: string } | null>(
    null,
  );
  const menuRef = useRef<HTMLDivElement>(null);
  const handledEdit = useRef<number>();
  useEffect(() => {
    if (!contextMenu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const close = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) setContextMenu(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', close);
    };
  }, [contextMenu]);
  useEffect(() => setContextMenu(null), [segment.id, segment.version, text]);
  const annotationRevision = JSON.stringify([bible, segment.comments]);
  const annotationRevisionRef = useRef(annotationRevision);
  const handlers = useRef({ onChange, onFocus, onSelection, onFinding });
  handlers.current = { onChange, onFocus, onSelection, onFinding };
  const annotationFindings = JSON.stringify(
    findings
      .filter((f) => f.status === 'open')
      .map(({ id, quote, severity, critic }) => ({
        id,
        quote,
        severity: critic === 'reader' ? 'P3' : severity,
      })),
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
      InlineReview,
      EntityMention,
      ForeshadowMark,
      PovMark,
      CommentMark,
      ManuscriptAnnotations,
    ],
    [],
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
          else if (element.closest('.entity-mention'))
            handlers.current.onSelection({
              segmentId: segment.id,
              quote: element.textContent ?? '',
              action: 'bible',
            });
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
    if (!editor || editor.isDestroyed) return;
    const scroll = editor.view.dom.closest('.manuscript-scroll');
    const top = scroll?.scrollTop;
    editor.view.dispatch(
      editor.state.tr.setMeta(manuscriptAnnotationsKey, {
        heat,
        heatmap,
        findings: JSON.parse(annotationFindings),
      }),
    );
    if (scroll && top !== undefined) scroll.scrollTop = top;
  }, [editor, heat, heatmap, annotationFindings]);
  useEffect(() => {
    if (!editor || !editable || !editRequest || handledEdit.current === editRequest.requestId)
      return;
    handledEdit.current = editRequest.requestId;
    const selection = editor.state.selection;
    if (editor.state.doc.textBetween(selection.from, selection.to, '\n') === editRequest.quote) {
      editor.commands.focus(undefined, { scrollIntoView: false });
      return;
    }
    const text = editor.getText({ blockSeparator: '\n' });
    const start = text.indexOf(editRequest.quote);
    if (start < 0 || !editRequest.quote) return;
    let offset = 0,
      from = 0,
      to = 0;
    editor.state.doc.descendants((node, pos) => {
      if (!node.isTextblock) return;
      if (start >= offset && start < offset + node.content.size) from = pos + 1 + start - offset;
      const end = start + editRequest.quote.length;
      if (end > offset && end <= offset + node.content.size) to = pos + 1 + end - offset;
      offset += node.content.size + 1;
    });
    if (!from || !to) return;
    editor.commands.setTextSelection({ from, to });
    editor.commands.focus(undefined, { scrollIntoView: false });
  }, [editor, editable, editRequest]);
  useEffect(() => {
    if (
      editor &&
      (editor.getText({ blockSeparator: '\n' }) !== text ||
        annotationRevisionRef.current !== annotationRevision)
    ) {
      const scroll = editor.view.dom.closest('.manuscript-scroll');
      const top = scroll?.scrollTop;
      const { from, to } = editor.state.selection;
      editor.commands.setContent(contentFor(segment, text, bible), false);
      const end = editor.state.doc.content.size;
      editor.commands.setTextSelection({ from: Math.min(from, end), to: Math.min(to, end) });
      if (scroll && top !== undefined) scroll.scrollTop = top;
      annotationRevisionRef.current = annotationRevision;
    }
  }, [text, editor, bible, segment, annotationRevision, editable]);
  const previewBlock = useRef<number | null>(null);
  const reviewId = review?.id,
    reviewQuote = review?.quote,
    keepVisibleOnClose = review?.keepVisibleOnClose;
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const anchor = reviewQuote ? reviewAnchor(editor.state.doc, reviewQuote) : null;
    setReviewLocated(anchor !== null);
    const previousBlock = previewBlock.current;
    if (keepVisibleOnClose && anchor !== null) {
      editor.state.doc.forEach((node, offset, index) => {
        if (offset + node.nodeSize === anchor) previewBlock.current = index;
      });
    } else if (!reviewId) {
      previewBlock.current = null;
    }
    editor.view.dispatch(
      editor.state.tr.setMeta(
        inlineReviewKey,
        reviewId ? { id: reviewId, quote: reviewQuote ?? '', host: reviewHost } : null,
      ),
    );
    if (!reviewId && previousBlock !== null) {
      // Removing the preview can collapse hundreds of pixels. Keep its sentence
      // in view instead of leaving the reader below the replacement.
      let target: HTMLElement | null = null;
      editor.state.doc.forEach((_node, offset, index) => {
        if (index === previousBlock) target = editor.view.nodeDOM(offset) as HTMLElement | null;
      });
      const block = target as HTMLElement | null;
      block?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [editor, reviewId, reviewQuote, reviewHost, text, keepVisibleOnClose]);
  const select = (action: SelectionAction) => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const quote = contextMenu?.quote ?? editor.state.doc.textBetween(from, to, '\n');
    setContextMenu(null);
    if (quote.trim() || action === 'review' || action === 'rewrite')
      handlers.current.onSelection({
        segmentId: segment.id,
        quote,
        action,
        version: segment.version,
      });
  };
  const actions = [
    ['edit', Pencil, '直接修改原文'],
    ['rewrite', RotateCcw, contextMenu && !contextMenu.quote ? '修改整个情节段' : '让模型修改'],
    ['review', ShieldCheck, '作者判断与审核'],
    ['comment', MessageSquare, m.comment],
    ['instruct', PenLine, m.instruct],
    ['plant', BookmarkPlus, m.plant],
    ['resolve', BookmarkCheck, m.resolve],
    ['lie', MessageCircleWarning, m.lie],
    ['bible', BookOpen, m.bible],
  ] as const;
  const visibleActions = actions.filter(([action]) =>
    availableActions
      ? availableActions.includes(action)
      : !['edit', 'rewrite', 'review'].includes(action),
  );
  const openContext = (event: React.MouseEvent | React.KeyboardEvent) => {
    if (!editor || (event.target as HTMLElement).closest('.inline-review-host')) return;
    event.preventDefault();
    const native = window.getSelection();
    const selected =
      native &&
      editor.view.dom.contains(native.anchorNode) &&
      editor.view.dom.contains(native.focusNode)
        ? native.toString()
        : '';
    const { from, to } = editor.state.selection;
    const quote = selected || editor.state.doc.textBetween(from, to, '\n');
    const rect = editor.view.dom.getBoundingClientRect();
    setContextMenu({
      x: Math.max(
        8,
        Math.min('clientX' in event ? event.clientX : rect.left + 20, window.innerWidth - 232),
      ),
      y: Math.max(
        8,
        Math.min('clientY' in event ? event.clientY : rect.top + 20, window.innerHeight - 260),
      ),
      quote,
    });
  };
  return (
    <div
      className="segment-editor"
      onContextMenu={openContext}
      onKeyDown={(event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
          openContext(event);
      }}
    >
      <EditorContent editor={editor} />
      {review &&
        createPortal(
          <>
            {!reviewLocated && (
              <p className="inline-review-missing">
                原文已变化，暂无法定位这条意见，请先核对引用。
              </p>
            )}
            {review.content}
          </>,
          reviewHost,
        )}
      {contextMenu &&
        createPortal(
          <div
            className="manuscript-context-menu"
            role="menu"
            aria-label="正文操作"
            ref={menuRef}
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onKeyDown={(event) => {
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
              );
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                buttons[
                  (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
                ]?.focus();
              }
              if (event.key === 'Tab') setContextMenu(null);
            }}
          >
            <small>{contextMenu.quote ? '已选原文' : '当前正文段'}</small>
            {visibleActions.map(([action, Icon, label]) => (
              <button
                key={action}
                role="menuitem"
                disabled={!contextMenu.quote.trim() && !['review', 'rewrite'].includes(action)}
                onClick={() => select(action)}
              >
                <Icon size={14} />
                {action === 'rewrite' && !contextMenu.quote.trim() ? '重写本段' : label}
              </button>
            ))}
          </div>,
          document.body,
        )}
      <div className="bubble-menu-mount">
        {editor && (
          <BubbleMenu
            editor={editor}
            shouldShow={({ editor: currentEditor }) =>
              !contextMenu && !review && !currentEditor.state.selection.empty
            }
            tippyOptions={{ duration: 120, placement: 'top', maxWidth: 'none' }}
          >
            <div className="selection-menu" role="toolbar" aria-label={m.selection}>
              {visibleActions.map(([action, Icon, label]) => (
                <button
                  key={action}
                  aria-label={label}
                  disabled={!!availableActions && !availableActions.includes(action)}
                  title={
                    availableActions && !availableActions.includes(action)
                      ? '此操作尚未接入真实后端'
                      : label
                  }
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
