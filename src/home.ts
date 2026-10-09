import "./style.css";
import { calculators } from "./calculators.ts";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <header>
    <h1>OpsCalc</h1>
    <p>DevOps / infra uchun kalkulyatorlar — har bir natija formulasi bilan</p>
  </header>
  <main class="home">
    ${calculators
      .map(
        (c) => `
      <a class="card calc-card${c.ready ? "" : " soon"}" href="${c.ready ? `./${c.slug}/` : "#"}">
        <h2>${c.title}</h2>
        <p>${c.desc}</p>
        <div class="tags">${c.tags.map((t) => `<span>${t}</span>`).join("")}${c.ready ? "" : "<span>tez kunda</span>"}</div>
      </a>`,
      )
      .join("")}
  </main>
`;
