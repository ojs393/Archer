import { AlertTriangle, RotateCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { EmptyState } from "@/components/EmptyState";
import { StaleBuildError } from "@/lib/lazyPanel";

interface Props {
  children: ReactNode;
  /** Changing this clears a caught error (for example the active tab). */
  resetKey: string;
}

interface State {
  error: Error | null;
  resetKey: string;
}

/** Keeps one broken panel from blanking the whole app. */
export class PanelBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("MamaDirect: panel crashed", error, info.componentStack);
  }

  private retry = () => {
    if (this.state.error instanceof StaleBuildError) window.location.reload();
    else this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return <EmptyState icon={AlertTriangle} title="This section failed to load" action={{ label: "Retry", icon: RotateCw, onClick: this.retry }} />;
  }
}
