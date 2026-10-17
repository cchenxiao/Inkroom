import { useId } from 'react';
import './continuity-option.css';
export function ContinuityOption({
  checked,
  onChange,
  disabled,
  current,
}: {
  checked: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
  current?: boolean;
}) {
  const help = useId();
  return (
    <section className="continuity-option" aria-label="衔接检查设置">
      <label>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={help}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>
          加强衔接检查 <small>试用</small>
        </span>
      </label>
      <p id={help}>
        额外核对人物、物件和数量的前后变化。耗时较长，可能误报；由你决定是否采纳意见。
      </p>
      {current !== undefined && (
        <small>
          本轮：{current ? '已开启' : '未开启'}
          {current !== checked ? ' · 新选择尚未执行' : ''}
        </small>
      )}
    </section>
  );
}
