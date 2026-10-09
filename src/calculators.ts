// Calculator registry. Add a new calculator here + its own folder/page.
export interface Calculator {
  slug: string; // folder name = URL path
  icon: string;
  title: string;
  desc: string;
  answers: string[]; // what the user gets
  tags: string[];
  ready: boolean;
}

export const calculators: Calculator[] = [
  {
    slug: "clickhouse",
    icon: "🗄️",
    title: "ClickHouse sizing",
    desc: "Logs, Traces va Metrics saqlash uchun server va disk hajmini hisoblaydi.",
    answers: ["SSD hajmi (node va klaster)", "Yozish / o'qish MB/s, IOPS", "RAM va vCPU"],
    tags: ["storage", "observability"],
    ready: true,
  },
  {
    slug: "kafka",
    icon: "📨",
    title: "Kafka sizing",
    desc: "Broker soni, disk va partitsiyalar.",
    answers: ["Disk hajmi", "Partitsiya soni", "Network throughput"],
    tags: ["streaming"],
    ready: false,
  },
  {
    slug: "kubernetes",
    icon: "☸️",
    title: "Kubernetes capacity",
    desc: "Podlar bo'yicha node soni va resurslar.",
    answers: ["Node soni", "CPU / RAM zaxirasi"],
    tags: ["compute"],
    ready: false,
  },
  {
    slug: "postgres",
    icon: "🐘",
    title: "PostgreSQL sizing",
    desc: "Ma'lumotlar bazasi uchun disk, IOPS va RAM.",
    answers: ["Disk va WAL", "IOPS", "shared_buffers"],
    tags: ["database"],
    ready: false,
  },
];
