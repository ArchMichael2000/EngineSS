import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Engine Sound Simulator crashed", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-dark-bg text-foreground flex items-center justify-center p-6">
          <div className="hud-panel rounded-lg p-6 max-w-md text-center">
            <h1 className="font-[Orbitron] text-neon-pink text-lg mb-2">Simulator Error</h1>
            <p className="font-[Rajdhani] text-sm text-muted-foreground">
              Something interrupted the audio lab. Refresh the page to restart the simulator.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
