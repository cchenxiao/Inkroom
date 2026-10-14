import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/shared/ui';
import { shellText as t } from '@/shared/lib/messages-shell';
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Inkloom boundary', error, info.componentStack);
  }
  render() {
    if (this.state.error) return <ErrorPage />;
    return this.props.children;
  }
}

export function ErrorPage() {
  return (
    <div className="error-page">
      <div className="eyebrow">INKLOOM / 500</div>
      <h1>{t.errorTitle}</h1>
      <p>{t.errorSub}</p>
      <Button onClick={() => window.location.reload()}>{t.reload}</Button>
    </div>
  );
}
