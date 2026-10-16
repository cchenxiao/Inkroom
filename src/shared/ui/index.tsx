import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
  type ReactNode,
} from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cva } from 'class-variance-authority';
import { X, Loader2, AlertCircle, Inbox, ChevronRight } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { zh } from '@/shared/lib/messages';
export { Chart } from './chart';
const buttonStyles = cva('ui-button', {
  variants: {
    variant: {
      default: 'button-primary',
      secondary: 'button-secondary',
      ghost: 'button-ghost',
      human: 'button-human',
      danger: 'button-danger',
    },
    size: { default: 'button-normal', sm: 'button-small', icon: 'button-icon' },
  },
  defaultVariants: { variant: 'secondary', size: 'default' },
});
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'ghost' | 'human' | 'danger';
  size?: 'default' | 'sm' | 'icon';
  disabledReason?: string;
  loading?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, disabledReason, loading, disabled, children, ...props }, ref) => {
    const button = (
      <button
        ref={ref}
        {...props}
        disabled={disabled || loading}
        className={cn(buttonStyles({ variant, size }), className)}
      >
        {loading && <Loader2 size={14} className="animate-spin" />}
        {children}
      </button>
    );
    return (disabled || loading) && disabledReason ? (
      <Tooltip content={disabledReason}>
        <span className="disabled-wrap" tabIndex={0}>
          {button}
        </span>
      </Tooltip>
    ) : (
      button
    );
  },
);
Button.displayName = 'Button';
export type BadgeTone =
  'ai' | 'human' | 'danger' | 'warning' | 'info' | 'muted' | 'success' | 'foreshadow';
export function Badge({
  tone = 'muted',
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span {...props} className={cn('badge', `badge-${tone}`, className)}>
      {children}
    </span>
  );
}
export const Chip = Badge;
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('ui-card', className)} />;
}
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={250}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content sideOffset={7} className="ui-tooltip">
            {content}
            <TooltipPrimitive.Arrow className="tooltip-arrow" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const descriptionId = useId();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="modal-overlay" />
        <DialogPrimitive.Content
          className={cn('modal-content', className)}
          aria-describedby={description ? descriptionId : undefined}
        >
          <header className="modal-heading">
            <div>
              <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description id={descriptionId}>
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <button className="icon-button" aria-label={zh.common.close}>
                <X size={18} />
              </button>
            </DialogPrimitive.Close>
          </header>
          <div className="modal-body">{children}</div>
          {footer && <footer className="modal-footer">{footer}</footer>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
export function Drawer({
  side = 'right',
  ...props
}: Parameters<typeof Modal>[0] & { side?: 'left' | 'right' }) {
  return <Modal {...props} className={`side-drawer side-drawer-${side}`} />;
}
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn('ui-input', className)} {...props} />
  ),
);
Input.displayName = 'Input';
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn('ui-input ui-textarea', className)} {...props} />
));
Textarea.displayName = 'Textarea';
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn('ui-input ui-select', className)} {...props} />
  ),
);
Select.displayName = 'Select';
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="ui-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function PageHeader({
  title,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('skeleton', className)} aria-busy="true" />;
}
export function Empty({
  title = zh.common.empty,
  description,
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="empty-state">
      <Inbox size={28} />
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  );
}
export function AsyncState({
  loading,
  error,
  empty,
  onRetry,
  children,
}: {
  loading?: boolean;
  error?: unknown;
  empty?: boolean;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  if (loading)
    return (
      <div className="async-skeleton" role="status" aria-label={zh.common.loading}>
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    );
  if (error)
    return (
      <div className="empty-state" role="alert">
        <AlertCircle size={24} />
        <strong>{zh.common.error}</strong>
        <p>{error instanceof Error ? error.message : ''}</p>
        {onRetry && <Button onClick={onRetry}>{zh.common.retry}</Button>}
      </div>
    );
  if (empty) return <Empty />;
  return <>{children}</>;
}
export function Progress({ value, label }: { value: number; label?: string }) {
  return (
    <div>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-label={label}
      >
        <span style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  );
}
export function Ring({ value, size = 36 }: { value: number; size?: number }) {
  const r = 14;
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" role="img" aria-label={`${value}%`}>
      <circle cx="18" cy="18" r={r} fill="none" stroke="var(--border)" strokeWidth="3" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke="var(--ai)"
        strokeWidth="3"
        strokeDasharray={`${(value / 100) * 2 * Math.PI * r} 100`}
        transform="rotate(-90 18 18)"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function Tabs({
  value,
  onValueChange,
  items,
}: {
  value: string;
  onValueChange: (s: string) => void;
  items: { value: string; label: string; content?: ReactNode }[];
}) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange}>
      <TabsPrimitive.List className="ui-tabs">
        {items.map((i) => (
          <TabsPrimitive.Trigger key={i.value} value={i.value}>
            {i.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {items.map((i) => (
        <TabsPrimitive.Content key={i.value} value={i.value}>
          {i.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
export function TreeItem({
  children,
  active,
  onClick,
  depth = 0,
  trailing,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  depth?: number;
  trailing?: ReactNode;
}) {
  return (
    <button
      className={cn('tree-item', active && 'active')}
      style={{ paddingLeft: 16 + depth * 18 }}
      onClick={onClick}
    >
      <ChevronRight size={12} />
      <span>{children}</span>
      {trailing}
    </button>
  );
}
