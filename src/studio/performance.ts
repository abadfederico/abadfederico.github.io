export class FrameSamples {
  private values = new Float32Array(120);
  private count = 0;
  private cursor = 0;
  add(ms: number) {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.values[this.cursor] = ms; this.cursor = (this.cursor + 1) % this.values.length;
    this.count = Math.min(this.count + 1, this.values.length);
  }
  summary() {
    const sorted = this.values.slice(0, this.count).sort();
    return { median: sorted[Math.floor(this.count * .5)] ?? 0, p95: sorted[Math.floor(this.count * .95)] ?? 0 };
  }
}

type TimerExtension = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
export class GpuTimer {
  private extension: TimerExtension | null;
  private pending: WebGLQuery[] = [];
  private current: WebGLQuery | null = null;
  private frame = 0;
  readonly samples = new FrameSamples();
  private gl: WebGL2RenderingContext;
  constructor(context: WebGLRenderingContext | WebGL2RenderingContext) {
    this.gl = context as WebGL2RenderingContext;
    this.extension = "beginQuery" in context ? context.getExtension("EXT_disjoint_timer_query_webgl2") : null;
  }
  get available() { return this.extension !== null; }
  begin() {
    const ext = this.extension, gl = this.gl;
    if (!ext || gl.isContextLost()) return;
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      for (const query of this.pending) gl.deleteQuery(query);
      this.pending.length = 0;
      return;
    }
    while (this.pending.length && gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const query = this.pending.shift()!;
      this.samples.add(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(query);
    }
    if (++this.frame % 20 || this.pending.length >= 3) return;
    this.current = gl.createQuery();
    if (this.current) gl.beginQuery(ext.TIME_ELAPSED_EXT, this.current);
  }
  end() {
    if (!this.current || !this.extension) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.pending.push(this.current); this.current = null;
  }
  dispose() {
    this.end();
    for (const query of this.pending) this.gl.deleteQuery(query);
    this.pending.length = 0;
  }
}
