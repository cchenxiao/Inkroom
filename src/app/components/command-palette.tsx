import { useShallow } from 'zustand/react/shallow';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowUpRight } from 'lucide-react';
import { Modal, Input } from '@/shared/ui';
import { useUIStore } from '@/shared/lib/ui-store';
import { useTree, useAction } from '@/shared/api/hooks';
import { zh } from '@/shared/lib/messages';
import { shellText as t } from '@/shared/lib/messages-shell';
export function CommandPalette() {
  const ui = useUIStore(
    useShallow(({ events: _events, node: _node, streamText: _stream, ...state }) => state),
  );
  const reset = useAction('/demo/reset');
  const stale = useAction('/demo/stale');
  const navigate = useNavigate();
  const { data: tree } = useTree();
  const [query, setQuery] = useState('');
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useUIStore.getState().setCommand(!useUIStore.getState().commandOpen);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        useUIStore.getState().setPanel('right', !useUIStore.getState().rightOpen);
      }
      if (e.key === 'Escape') useUIStore.getState().setFocus(false);
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const commands = [
    ...(import.meta.env.VITE_ENABLE_MOCK !== 'false'
      ? [
          {
            id: 'reset-demo',
            label: t.resetDemo,
            run: () =>
              reset.mutate(
                {},
                {
                  onSuccess: () => {
                    ui.setChapter('ch7');
                    ui.setBranch('main');
                    ui.setPanel('left', true);
                    ui.setPanel('right', true);
                    ui.setDrawer('closed');
                    navigate('/workspace');
                  },
                },
              ),
          },
          {
            id: 'stale-demo',
            label: t.simulateStale,
            run: () => stale.mutate({ draftVersion: 0 }, { onSuccess: () => ui.setStale(true) }),
          },
        ]
      : []),
    ...Object.entries(zh.nav).map(([key, label]) => ({
      id: key,
      label,
      run: () => navigate('/' + key),
    })),
    ...(tree ?? []).map((c) => ({
      id: c.id,
      label: `第 ${c.number} 章 · ${c.title}`,
      run: () => {
        ui.setChapter(c.id);
        navigate('/workspace');
      },
    })),
  ].filter((x) => x.label.toLowerCase().includes(query.toLowerCase()));
  return (
    <Modal open={ui.commandOpen} onOpenChange={ui.setCommand} title={t.command}>
      <div className="command-search">
        <Search size={18} />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.commandHint}
          aria-label={t.commandHint}
        />
      </div>
      <div className="command-results">
        {commands.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              c.run();
              ui.setCommand(false);
              setQuery('');
            }}
          >
            {c.label}
            <ArrowUpRight size={14} />
          </button>
        ))}
        {!commands.length && <p>{t.noCommand}</p>}
      </div>
    </Modal>
  );
}
