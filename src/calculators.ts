// Calculator registry. Add a new calculator here + its own folder/page.
export interface Calculator {
  slug: string; // folder name = URL path
  title: string;
  desc: string;
  ready: boolean;
}

export const calculators: Calculator[] = [
  { slug: "clickhouse", title: "ClickHouse", desc: "Disk, IOPS, RAM and CPU for logs, traces and metrics.", ready: true },
  { slug: "kafka", title: "Kafka", desc: "Brokers, disk and partitions.", ready: false },
  { slug: "kubernetes", title: "Kubernetes", desc: "Node count and resource headroom.", ready: false },
  { slug: "postgres", title: "PostgreSQL", desc: "Disk, IOPS and memory.", ready: false },
];
