import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SegmentEditor } from '@/features/workspace/editor/SegmentEditor';
import { seedDocuments } from '@/mocks/data/seed';
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
