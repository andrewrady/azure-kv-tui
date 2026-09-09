import { TextRenderable, type RenderContext } from "@opentui/core";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * A small animated status line, standing in for Spectre.Console's Status()
 * spinner -- OpenTUI has no built-in spinner/progress widget. Mutating
 * `.content` is enough to trigger a re-render; no manual refresh call needed.
 */
export class Spinner {
  readonly renderable: TextRenderable;
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private label = "";

  constructor(ctx: RenderContext) {
    this.renderable = new TextRenderable(ctx, { content: "" });
  }

  start(label: string): void {
    this.label = label;
    this.stop();
    this.renderable.content = `${FRAMES[0]} ${this.label}`;
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % FRAMES.length;
      this.renderable.content = `${FRAMES[this.frame]} ${this.label}`;
    }, 80);
  }

  setLabel(label: string): void {
    this.label = label;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.renderable.content = "";
  }
}
