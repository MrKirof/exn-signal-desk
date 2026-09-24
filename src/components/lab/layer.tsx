import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * One screen layer. If it throws, only this block stops.
 * The nav and the other layers keep working.
 */
export class Layer extends Component<{ name: string; children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };

  static getDerivedStateFromError(err: unknown) {
    return { err: err instanceof Error ? err.message : "This layer stopped" };
  }

  render() {
    if (this.state.err) {
      return (
        <div className="panel p-4 text-sm">
          <p className="font-medium">{this.props.name} stopped. The other layers are still on.</p>
          <p className="mt-1 text-muted">{this.state.err}</p>
          <Button className="mt-3" size="sm" onClick={() => this.setState({ err: null })}>
            Resume
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
