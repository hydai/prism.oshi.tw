import { Component, type ReactNode } from 'react';

/** A failed/lost chunk should leave navigation usable and offer recovery. */
export class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="p-6 text-slate-700">
        <p>This page could not load. Reload to get the latest version.</p>
        <button type="button" className="mt-3 rounded bg-slate-200 px-3 py-2" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
