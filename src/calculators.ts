// Calculator registry. Add a new calculator here + its own folder/page.
export interface Calculator {
  slug: string; // folder name = URL path
  title: string;
  desc: string;
  tags: string[];
  ready: boolean;
}

export const calculators: Calculator[] = [
  {
    slug: "clickhouse",
    title: "ClickHouse sizing",
    desc: "Logs, Traces va Metrics uchun SSD hajmi, throughput, IOPS, RAM va vCPU.",
    tags: ["storage", "observability"],
    ready: true,
  },
];
