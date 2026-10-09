import "./style.css";
import { calculators } from "./calculators.ts";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div class="landing">
    <section class="hero">
      <h1>OpsCalc</h1>
      <p>Infrastructure sizing calculators. Every result shows its formula.</p>
    </section>
    <section class="list">
      ${calculators
        .map(
          (c) => `
        <a class="row${c.ready ? "" : " soon"}" href="${c.ready ? `./${c.slug}/` : "#"}">
          <b>${c.title}</b><span>${c.desc}</span><i>${c.ready ? "→" : "soon"}</i>
        </a>`,
        )
        .join("")}
    </section>
    <footer><a href="https://github.com/bakhod1r/opsclac">GitHub</a></footer>
  </div>
`;
