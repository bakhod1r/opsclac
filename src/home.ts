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
        <div class="row${c.ready ? "" : " soon"}">
          <a href="./${c.slug}/"><b>${c.title}</b></a><span>${c.desc}</span>
          <i>${c.ready ? `<a href="./${c.slug}/guide/">guide</a> · <a href="./${c.slug}/design/">design</a> · <a href="./${c.slug}/">open →</a>` : "soon"}</i>
        </div>`,
        )
        .join("")}
    </section>
    <footer><a href="https://github.com/bakhod1r/opsclac">GitHub</a></footer>
  </div>
`;
