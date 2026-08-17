/**
 * Split streaming deltas into sentence-ish provisional segments.
 * Flushes on 。！？.!?\n or when softMax exceeded (minimal usable stream unit).
 */

const SENTENCE_END = /([。！？.!?\n])/;

export class SentenceSegmentBuffer {
  private pending = "";

  constructor(private readonly softMax = 48) {}

  push(delta: string): string[] {
    if (!delta) return [];
    this.pending += delta;
    const out: string[] = [];

    while (true) {
      const match = SENTENCE_END.exec(this.pending);
      if (!match || match.index === undefined) break;
      const end = match.index + match[0].length;
      const segment = this.pending.slice(0, end);
      this.pending = this.pending.slice(end);
      if (segment) out.push(segment);
    }

    if (this.pending.length >= this.softMax) {
      out.push(this.pending);
      this.pending = "";
    }

    return out;
  }

  flush(): string | null {
    const rest = this.pending;
    this.pending = "";
    return rest || null;
  }
}
