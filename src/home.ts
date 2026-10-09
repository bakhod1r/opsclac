import "./style.css";
import { calculators } from "./calculators.ts";

const first = calculators.find((c) => c.ready)!;

const card = (c: (typeof calculators)[number]) => `
  <a class="card calc-card${c.ready ? "" : " soon"}" href="${c.ready ? `./${c.slug}/` : "#"}">
    <div class="calc-head"><span class="icon">${c.icon}</span><h3>${c.title}</h3>${c.ready ? "" : '<span class="badge">tez kunda</span>'}</div>
    <p>${c.desc}</p>
    <ul>${c.answers.map((a) => `<li>${a}</li>`).join("")}</ul>
    ${c.ready ? '<span class="open">Ochish →</span>' : ""}
  </a>`;

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div class="landing">
    <section class="hero">
      <span class="logo">OpsCalc</span>
      <h1>Serverga qancha resurs kerakligini<br/>taxmin qilmang — <span class="hl">hisoblang</span></h1>
      <p class="lead">DevOps va infra muhandislari uchun bepul kalkulyatorlar. Raqamlaringizni kiriting,
      natija va <b>har bir formulani</b> qadamma-qadam ko'ring.</p>
      <div class="cta">
        <a class="btn primary" href="./${first.slug}/">${first.icon} ${first.title} ni boshlash</a>
        <a class="btn" href="#calcs">Barcha kalkulyatorlar</a>
      </div>
    </section>

    <section class="how">
      <h2>Qanday ishlaydi?</h2>
      <div class="steps3">
        <div class="card"><b>1</b><h3>Kalkulyatorni tanlang</h3><p>Masalan, ClickHouse uchun disk hajmi.</p></div>
        <div class="card"><b>2</b><h3>Raqamlarni kiriting</h3><p>Request/soat, retention, replika… Har maydon yonida maslahat bor.</p></div>
        <div class="card"><b>3</b><h3>Natija + formula</h3><p>Natija darhol yangilanadi va qanday hisoblangani ko'rsatiladi.</p></div>
      </div>
    </section>

    <section id="calcs">
      <h2>Kalkulyatorlar</h2>
      <div class="grid">${calculators.map(card).join("")}</div>
    </section>

    <section class="why">
      <div class="card"><h3>🔍 Shaffof</h3><p>Hech qanday "qora quti" yo'q — har bir raqam formula bilan.</p></div>
      <div class="card"><h3>⚡ Tez</h3><p>Brauzerda ishlaydi, ro'yxatdan o'tish shart emas.</p></div>
      <div class="card"><h3>💾 Eslab qoladi</h3><p>Kiritgan qiymatlaringiz brauzeringizda saqlanadi.</p></div>
    </section>

    <footer>
      <a href="https://github.com/bakhod1r/opsclac">GitHub</a> · Ochiq manba · Yangi kalkulyator g'oyasi bo'lsa — issue oching
    </footer>
  </div>
`;
