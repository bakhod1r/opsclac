// Estimate log line size and ClickHouse compression from a pasted sample.
// Runs fully in the browser: the sample never leaves the page.

export type Codec = "zstd" | "lz4";

/** Row-wise gzip → ClickHouse columnar codec. Rough factors: columns compress better than rows. */
export const CODEC_FACTOR: Record<Codec, number> = { zstd: 1.2, lz4: 0.85 };

export interface SampleStats {
  lines: number;
  rawBytes: number;
  avgBytes: number;
  minBytes: number;
  maxBytes: number;
  gzipBytes?: number;
  gzipRatio?: number;
  estRatio?: number;
  jsonShare: number; // share of lines that parse as JSON objects
}

export function lineStats(text: string): Omit<SampleStats, "gzipBytes" | "gzipRatio" | "estRatio"> {
  const enc = new TextEncoder();
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const sizes = lines.map((l) => enc.encode(l).length + 1); // +1 for the newline
  const rawBytes = sizes.reduce((a, b) => a + b, 0);
  let json = 0;
  for (const l of lines) {
    const t = l.trim();
    if (t.startsWith("{")) {
      try {
        JSON.parse(t);
        json++;
      } catch {
        /* not JSON */
      }
    }
  }
  return {
    lines: lines.length,
    rawBytes,
    avgBytes: lines.length ? rawBytes / lines.length : 0,
    minBytes: sizes.length ? Math.min(...sizes) : 0,
    maxBytes: sizes.length ? Math.max(...sizes) : 0,
    jsonShare: lines.length ? json / lines.length : 0,
  };
}

async function gzipSize(text: string): Promise<number | undefined> {
  if (typeof CompressionStream === "undefined") return undefined;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  return buf.byteLength;
}

export async function analyzeSample(text: string, codec: Codec): Promise<SampleStats> {
  const s = lineStats(text);
  if (!s.lines) return s;
  const joined = text.split(/\r?\n/).filter((l) => l.trim() !== "").join("\n") + "\n";
  const gz = await gzipSize(joined);
  if (!gz) return s;
  const gzipRatio = s.rawBytes / gz;
  return { ...s, gzipBytes: gz, gzipRatio, estRatio: gzipRatio * CODEC_FACTOR[codec] };
}
