import { useState } from 'react';
import { PenLine } from 'lucide-react';
import { Button, Modal, Field, Select } from '@/shared/ui';
import { useAction } from '@/shared/api/hooks';
import { pages as t } from '@/shared/lib/messages-pages';
import type { ChangeSet } from '@/types/domain';
export default function SuggestionDialog({
  open,
  onOpenChange,
  version,
  stale,
  onPreview,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  version: number;
  stale: boolean;
  onPreview: (value: ChangeSet) => void;
}) {
  const [kind, setKind] = useState('project');
  const suggest = useAction<ChangeSet, unknown>('/projects/project-zhuoliu/suggestions');
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t.common.suggestion}
      description={t.common.note}
      footer={
        <Button
          variant="human"
          disabled={suggest.isPending || !version || stale}
          disabledReason={t.common.stale}
          onClick={() =>
            void suggest
              .mutateAsync({ kind, draftVersion: version })
              .then((result) => {
                onOpenChange(false);
                onPreview(result);
              })
              .catch(() => undefined)
          }
        >
          <PenLine size={14} />
          {t.common.suggestion}
        </Button>
      }
    >
      <Field label={t.changes.targetType}>
        <Select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="project">{t.prepare.premise}</option>
          <option value="characters">{t.bible.tabs.characters}</option>
          <option value="rules">{t.bible.tabs.rules}</option>
          <option value="style">{t.bible.tabs.style}</option>
        </Select>
      </Field>
      {suggest.error && (
        <p role="alert" className="page-error">
          {suggest.error.message}
        </p>
      )}
    </Modal>
  );
}
