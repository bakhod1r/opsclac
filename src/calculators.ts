// Calculator registry. Add a new calculator here + its own folder/page.
export interface Calculator {
  slug: string; // folder name = URL path
  title: string;
  desc: string;
  ready: boolean;
}

export const calculators: Calculator[] = [
  { slug: "clickhouse", title: "ClickHouse servers for logs, metrics & traces", desc: "Pick servers: disk, IOPS, RAM and CPU.", ready: true },
  { slug: "kafka", title: "Kafka", desc: "Brokers, disk and partitions.", ready: false },
  { slug: "kubernetes", title: "Kubernetes", desc: "Node count and resource headroom.", ready: false },
  { slug: "postgres", title: "PostgreSQL", desc: "Disk, IOPS and memory.", ready: false },
];
