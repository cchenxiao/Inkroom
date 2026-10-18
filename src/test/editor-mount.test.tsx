import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SegmentEditor } from '@/features/workspace/editor/SegmentEditor';
import { seedDocuments } from '@/mocks/data/seed';
// Keep the real editor/transactions; floating tooltip positioning requires a browser.
vi.mock('@tiptap/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tiptap/react')>()),
  BubbleMenu: () => null,
}));
describe('editor document hydration', () => {
  it('does not autosave when mounting a manuscript or toggling its editability', async () => {
    const segment = seedDocuments().ch7.segments[0];
    const onChange = vi.fn();
    const props = {
      segment,
      text: segment.text,
      findings: [],
      editable: true,
      heatmap: false,
      onChange,
      onFocus: vi.fn(),
      onSelection: vi.fn(),
      onFinding: vi.fn(),
    };
    const { container, rerender } = render(<SegmentEditor {...props} />);
    await waitFor(() => expect(container.querySelector('.tiptap')).toHaveTextContent(segment.text));
    expect(onChange).not.toHaveBeenCalled();
    rerender(<SegmentEditor {...props} editable={false} />);
    expect(onChange).not.toHaveBeenCalled();
  });
});

it('shows and closes a nearby review without saving its UI as author text', async () => {
  const segment = { ...seedDocuments().ch7.segments[0], text: '前段。\n引用证据。\n后段。' };
  const onChange = vi.fn();
  const props = {
    segment,
    text: segment.text,
    findings: [],
    editable: true,
    heatmap: false,
    onChange,
    onFocus: vi.fn(),
    onSelection: vi.fn(),
    onFinding: vi.fn(),
  };
  const { container, rerender } = render(
    <SegmentEditor
      {...props}
      review={{
        id: 'test',
        quote: '引用证据。',
        content: <aside aria-label="问题详情">核对这个句子</aside>,
      }}
    />,
  );
  await waitFor(() =>
    expect(
      container.querySelector('.inline-review-host')?.previousElementSibling,
    ).toHaveTextContent('引用证据。'),
  );
  expect(container.querySelector('.inline-review-host')?.nextElementSibling).toHaveTextContent(
    '后段。',
  );
  expect(onChange).not.toHaveBeenCalled();
  rerender(<SegmentEditor {...props} />);
  await waitFor(() => expect(container.querySelector('.inline-review-host')).toBeNull());
  expect(onChange).not.toHaveBeenCalled();
});

it('updates findings and heatmap without recreating the editor or saving text', async () => {
  const segment = seedDocuments().ch7.segments[0];
  const onChange = vi.fn();
  const props = {
    segment,
    text: segment.text,
    findings: [],
    editable: true,
    heatmap: false,
    onChange,
    onFocus: vi.fn(),
    onSelection: vi.fn(),
    onFinding: vi.fn(),
  };
  const { container, rerender } = render(<SegmentEditor {...props} />);
  await waitFor(() => expect(container.querySelector('.tiptap')).toBeInTheDocument());
  const original = container.querySelector('.tiptap');
  rerender(
    <SegmentEditor
      {...props}
      heatmap
      segment={{ ...segment, styleStats: { ...segment.styleStats, aiTaste: 0.8 } }}
      findings={[
        {
          id: 'fresh',
          quote: segment.text.slice(0, 5),
          status: 'open',
          severity: 'P3',
          critic: 'ai_taste',
        } as import('@/types/domain').Finding,
      ]}
    />,
  );
  await waitFor(() =>
    expect(container.querySelector('[data-finding-id="fresh"]')).toBeInTheDocument(),
  );
  expect(container.querySelector('.tiptap')).toBe(original);
  expect(container.querySelector('.ai-heat')).toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});

it('keeps the changed sentence visible when its selection preview closes', async () => {
  const segment = { ...seedDocuments().ch7.segments[0], text: '前段。\n选中原句。\n后段。' };
  const props = {
    segment,
    text: segment.text,
    findings: [],
    editable: false,
    heatmap: false,
    onChange: vi.fn(),
    onFocus: vi.fn(),
    onSelection: vi.fn(),
    onFinding: vi.fn(),
  };
  const scrolled: string[] = [];
  const previous = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = function () {
    scrolled.push(this.textContent ?? '');
  };
  try {
    const { container, rerender } = render(
      <SegmentEditor
        {...props}
        review={{
          id: 'selection',
          quote: '选中原句。',
          keepVisibleOnClose: true,
          content: <aside>替换预览</aside>,
        }}
      />,
    );
    await waitFor(() => expect(container.querySelector('.inline-review-host')).toBeInTheDocument());
    rerender(<SegmentEditor {...props} text={'前段。\n修改后的句子。\n后段。'} />);
    await waitFor(() => expect(scrolled).toContain('修改后的句子。'));
    expect(props.onChange).not.toHaveBeenCalled();
    expect(container.querySelector('.inline-review-host')).toBeNull();
  } finally {
    HTMLElement.prototype.scrollIntoView = previous;
  }
});
