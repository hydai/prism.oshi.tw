import { Component, type ReactNode } from 'react';
import { Button } from './ui/Button';
import { EmptyState } from './ui/Display';

/** A failed/lost chunk should leave navigation usable and offer recovery. */
export class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert">
        <EmptyState
          icon="alert"
          title="This page could not load."
          body="Reload to get the latest version."
          action={
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        />
      </div>
    );
  }
}
