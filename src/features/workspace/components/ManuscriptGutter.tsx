import { useEffect, useState, type RefObject } from 'react';
import type { Finding } from '@/types/domain';
import { workspaceMessages as m } from '@/shared/lib/messages-workspace';
interface Marker {
  id: string;
  top: number;
  order: string;
  beat: string;
  findings: Finding[];
}
/** Gutter lives outside the scroll surface; a single animation-frame read aligns visible rows. */
export function ManuscriptGutter({
  scrollRef,
  findings,
  onSelect,
  revision,
}: {
  scrollRef: RefObject<HTMLDivElement>;
  findings: Finding[];
  onSelect: (id: string) => void;
  revision: string;
}) {
  const [lines, setLines] = useState<{ number: number; top: number }[]>([]);
  const [markers, setMarkers] = useState<Marker[]>([]);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = scroller.getBoundingClientRect();
        const next = [...scroller.querySelectorAll<HTMLElement>('[data-manuscript-segment]')]
          .map((row) => ({
            id: row.dataset.manuscriptSegment!,
            order: row.dataset.segmentOrder ?? '',
            beat: row.dataset.beatTitle ?? '',
            top: row.getBoundingClientRect().top - box.top + 14,
            findings: findings.filter(
              (f) => f.segmentId === row.dataset.manuscriptSegment && f.status === 'open',
            ),
          }))
          .filter((row) => row.top > -40 && row.top < box.height);
        setMarkers(next);
        let lineNumber = 0;
        const measured: { number: number; top: number }[] = [];
        scroller.querySelectorAll('.tiptap p').forEach((paragraph) => {
          const range = document.createRange();
          range.selectNodeContents(paragraph);
          const tops: number[] = [];
          const tolerance = parseFloat(getComputedStyle(paragraph).lineHeight) / 2 || 8;
          const rects = Array.from(range.getClientRects?.() ?? [])
            .filter((r) => r.width > 0)
            .sort((a, b) => a.top - b.top);
          for (const rect of rects) {
            if (!tops.length || rect.top - tops[tops.length - 1] > tolerance) tops.push(rect.top);
          }
          for (const top of tops) {
            lineNumber++;
            if (top >= box.top - 30 && top <= box.bottom)
              measured.push({ number: lineNumber, top: top - box.top });
          }
        });
        setLines(measured);
      });
    };
    scroller.addEventListener('scroll', sync, { passive: true });
    const resize = new ResizeObserver(sync);
    resize.observe(scroller);
    const mutation = new MutationObserver(sync);
    mutation.observe(scroller, { childList: true, subtree: true, characterData: true });
    sync();
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', sync);
      resize.disconnect();
      mutation.disconnect();
    };
  }, [scrollRef, findings, revision]);
  return (
    <div className="manuscript-gutter" aria-label={m.annotations}>
      {lines.map((line) => (
        <span
          key={line.number}
          className="manuscript-line-number"
          aria-hidden="true"
          style={{ top: line.top }}
        >
          {line.number}
        </span>
      ))}
      {markers.map((marker) => (
        <div
          key={marker.id}
          className="gutter-marker"
          style={{ transform: `translateY(${marker.top}px)` }}
        >
          <span className="gutter-number" title={marker.beat}>
            {marker.order.padStart(2, '0')}
          </span>
          {marker.findings.slice(0, 3).map((f) => (
            <button
              key={f.id}
              className={`gutter-dot dot-${f.critic === 'reader' ? 'p3' : f.severity.toLowerCase()}`}
              aria-label={`${f.critic === 'reader' ? 'P3' : f.severity} ${m.critics[f.critic]} ${m.details}`}
              title={f.reason}
              onClick={() => onSelect(f.id)}
            >
              {f.critic === 'reader' ? 'P3' : f.severity}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
