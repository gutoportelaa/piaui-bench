/* PiauíBench — app estático: mostra resultados pré-computados e roda o
   benchmark ao vivo contra um Ollama local a partir do navegador. */

const LETRAS = ["A", "B", "C", "D", "E"];
const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
const corDe = (i) => SERIES[i % SERIES.length];
const pct = (v) => (v * 100).toFixed(1) + "%";

let BENCH = null;
let ULTIMO_VIVO = null;

/* ---------------- abas + tema ---------------- */
document.querySelectorAll(".abas button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".abas button").forEach((b) => b.setAttribute("aria-selected", "false"));
    btn.setAttribute("aria-selected", "true");
    document.querySelectorAll(".painel").forEach((p) => p.classList.remove("ativa", "ativo"));
    document.getElementById("painel-" + btn.dataset.painel).classList.add("ativo");
  });
});

document.getElementById("btn-tema").addEventListener("click", () => {
  const atual = document.documentElement.getAttribute("data-theme");
  const escuroAgora = atual === "dark" || (!atual && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", escuroAgora ? "light" : "dark");
});

/* ---------------- gráfico de barras ---------------- */
function desenhaGrafico(alvo, resultados) {
  alvo.innerHTML = resultados
    .map((r, i) => `
      <div class="barra-linha">
        <div class="barra-topo">
          <span class="barra-nome"><span class="chip" style="background:${corDe(i)}"></span>${r.modelo}</span>
          <span class="barra-valor">${pct(r.acuracia)}</span>
        </div>
        <div class="barra-trilho">
          <div class="barra-fill" style="width:${(r.acuracia * 100).toFixed(1)}%;background:${corDe(i)}"
               title="${r.modelo}: ${r.acertos}/${r.total} respostas corretas"></div>
        </div>
        <div class="barra-meta">${r.acertos}/${r.total} respostas corretas · ${r.latencia_media_s}s por resposta</div>
      </div>`)
    .join("");
}

function desenhaLegenda(alvo, resultados) {
  alvo.innerHTML =
    resultados.map((r, i) => `<span><span class="chip" style="background:${corDe(i)}"></span>${r.modelo}</span>`).join("") +
    `<span style="color:var(--text-muted)">Baseline aleatório: 20%</span>`;
}

function desenhaTiles(alvo, dados) {
  const melhor = dados.resultados[0];
  const rapido = [...dados.resultados].sort((a, b) => a.latencia_media_s - b.latencia_media_s)[0];
  const acertosTodos = BENCH.questoes.filter((q) =>
    dados.resultados.every((r) => (r.detalhes.find((d) => d.questao === q.id) || {}).correta)).length;
  const errosTodos = BENCH.questoes.filter((q) =>
    dados.resultados.every((r) => !(r.detalhes.find((d) => d.questao === q.id) || {}).correta)).length;

  alvo.innerHTML = `
    <div class="tile"><div class="rotulo">Melhor acurácia</div><div class="num">${pct(melhor.acuracia)}</div><div class="sub">${melhor.modelo}</div></div>
    <div class="tile"><div class="rotulo">Mais rápido</div><div class="num">${rapido.latencia_media_s}s</div><div class="sub">${rapido.modelo}</div></div>
    <div class="tile"><div class="rotulo">Questões unânimes</div><div class="num">${acertosTodos}/10</div><div class="sub">acertadas por todos</div></div>
    <div class="tile"><div class="rotulo">Questões difíceis</div><div class="num">${errosTodos}/10</div><div class="sub">erradas por todos</div></div>`;
}

/* ---------------- matriz questão × modelo ---------------- */
function desenhaMatriz(tabela, dados) {
  const cab = dados.resultados
    .map((r, i) => `<th class="centro"><span class="chip" style="background:${corDe(i)};display:inline-block"></span> ${r.modelo}</th>`)
    .join("");

  const linhas = BENCH.questoes.map((q) => {
    const celulas = dados.resultados.map((r) => {
      const d = r.detalhes.find((x) => x.questao === q.id);
      if (!d) return `<td class="centro">—</td>`;
      const ok = d.correta;
      return `<td class="centro"><span class="marca ${ok ? "ok" : "nao"}">${ok ? "✓" : "✗"}</span>
              <span style="color:var(--text-muted)"> ${d.resposta_moda || "?"}</span></td>`;
    }).join("");
    return `<tr>
      <td><strong>${q.id}</strong> <span class="tag">${q.categoria}</span><div class="q-txt" style="color:var(--text-secondary);font-size:.85rem;margin-top:3px">${q.pergunta}</div></td>
      <td class="centro"><strong>${q.resposta}</strong></td>
      ${celulas}</tr>`;
  }).join("");

  const rodape = `<tr><td><strong>Acurácia</strong></td><td class="centro">—</td>` +
    dados.resultados.map((r) => `<td class="centro"><strong>${pct(r.acuracia)}</strong></td>`).join("") + `</tr>`;

  tabela.innerHTML = `<thead><tr><th>Questão</th><th class="centro">Gabarito</th>${cab}</tr></thead>
                      <tbody>${linhas}${rodape}</tbody>`;
}

/* ---------------- robustez: ordem fixa × permutada ---------------- */
function desenhaRobustez(dados, shuf) {
  const porModelo = Object.fromEntries(shuf.resultados.map((r) => [r.modelo, r]));
  const linhas = dados.resultados.filter((r) => porModelo[r.modelo]);
  if (!linhas.length) return false;

  document.getElementById("grafico-robustez").innerHTML = linhas.map((r, i) => {
    const s = porModelo[r.modelo];
    const delta = s.acuracia - r.acuracia;
    const sinal = delta >= 0 ? "+" : "−";
    const barra = (valor, hachurada) => `
      <div class="barra-topo">
        <span class="barra-meta">${hachurada ? "permutada" : "ordem fixa"}</span>
        <span class="barra-valor" style="font-size:.85rem">${pct(valor)}</span>
      </div>
      <div class="barra-trilho">
        <div class="barra-fill${hachurada ? " hachura" : ""}"
             style="width:${(valor * 100).toFixed(1)}%;background-color:${corDe(i)}"></div>
      </div>`;
    return `<div class="barra-linha par-linha">
      <div class="barra-nome"><span class="chip" style="background:${corDe(i)}"></span>${r.modelo}
        <span class="barra-meta">· variação ${sinal}${Math.abs(delta * 100).toFixed(1)} p.p.</span></div>
      ${barra(r.acuracia, false)}
      ${barra(s.acuracia, true)}
    </div>`;
  }).join("");
  document.getElementById("cartao-robustez").style.display = "";
  return true;
}

function desenhaLetras(shuf) {
  const comDist = shuf.resultados.filter((r) => r.distribuicao_letras);
  if (!comDist.length) return;
  const linhas = comDist.map((r, i) => {
    const max = Math.max(...LETRAS.map((l) => r.distribuicao_letras[l] || 0)) || 1;
    const total = LETRAS.reduce((a, l) => a + (r.distribuicao_letras[l] || 0), 0) || 1;
    const celulas = LETRAS.map((l) => {
      const n = r.distribuicao_letras[l] || 0;
      return `<td><div class="dist">
        <span style="font-variant-numeric:tabular-nums;min-width:3.6em">${n} <span style="color:var(--text-muted)">(${Math.round(n / total * 100)}%)</span></span>
        <span class="dist-trilho"><span class="dist-fill" style="width:${(n / max * 100).toFixed(0)}%;background:${corDe(i)}"></span></span>
      </div></td>`;
    }).join("");
    return `<tr><td><span class="chip" style="background:${corDe(i)};display:inline-block"></span>
      <span style="font-family:var(--mono);font-size:.85rem">${r.modelo}</span></td>${celulas}</tr>`;
  }).join("");
  document.getElementById("tabela-letras").innerHTML =
    `<thead><tr><th>Modelo</th>${LETRAS.map((l) => `<th>Escolheu ${l}</th>`).join("")}</tr></thead><tbody>${linhas}</tbody>`;
  document.getElementById("cartao-letras").style.display = "";
}

/* ---------------- questões ---------------- */
function desenhaQuestoes() {
  document.getElementById("lista-questoes").innerHTML = BENCH.questoes.map((q) => `
    <div class="questao">
      <span class="tag">${q.id} · ${q.categoria}</span>
      <h3>${q.pergunta}</h3>
      <ol type="A">
        ${LETRAS.map((l) => `<li class="${l === q.resposta ? "certa" : ""}">${q.alternativas[l]}${l === q.resposta ? " ✓" : ""}</li>`).join("")}
      </ol>
      <div class="fonte">Fonte: ${q.fonte}</div>
    </div>`).join("");
}

/* ---------------- execução ao vivo ---------------- */
const FORMATO = {
  type: "object",
  properties: { resposta: { type: "string", enum: LETRAS } },
  required: ["resposta"],
};

const SYSTEM = "Voce e um especialista em geografia, historia e cultura do Estado do Piaui, Brasil. " +
  "Responda as questoes de multipla escolha escolhendo exatamente uma alternativa. " +
  "Responda somente com a letra da alternativa correta (A, B, C, D ou E), sem explicacao.";

function montaPrompt(q) {
  return [q.pergunta, "", ...LETRAS.map((l) => `${l}) ${q.alternativas[l]}`), "",
    "Responda apenas com a letra da alternativa correta."].join("\n");
}

function extraiLetra(texto) {
  if (!texto) return null;
  try {
    const j = JSON.parse(texto.trim());
    const v = String(j.resposta || "").trim().toUpperCase();
    if (LETRAS.includes(v[0])) return v[0];
  } catch (_) { /* texto livre */ }
  const limpo = texto.replace(/<think>[\s\S]*?<\/think>/gi, " ").toUpperCase();
  const m = limpo.match(/\b([A-E])\b/);
  return m ? m[1] : null;
}

const host = () => document.getElementById("host").value.replace(/\/+$/, "");
const status = (msg) => (document.getElementById("status").textContent = msg);

document.getElementById("btn-conectar").addEventListener("click", async () => {
  status("Conectando…");
  try {
    const r = await fetch(host() + "/api/tags");
    if (!r.ok) throw new Error("HTTP " + r.status);
    const { models } = await r.json();
    const nomes = models.map((m) => m.name).sort();
    const preferidos = ["llama3.2:3b", "qwen3:4b", "gemma3:4b"];
    document.getElementById("modelos-lista").innerHTML =
      `<p class="nota" style="margin:0">Selecione até 3 modelos:</p>` +
      nomes.map((n) => `<label><input type="checkbox" value="${n}" ${preferidos.includes(n) ? "checked" : ""}> ${n}</label>`).join("");
    document.getElementById("btn-rodar").disabled = false;
    status(`Conectado · ${nomes.length} modelos disponíveis.`);
  } catch (e) {
    status(`Falha ao conectar: ${e.message}. Verifique se o Ollama está rodando com OLLAMA_ORIGINS="*".`);
  }
});

async function perguntaModelo(modelo, q, seed) {
  const corpo = {
    model: modelo,
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: montaPrompt(q) }],
    stream: false, format: FORMATO, think: false,
    options: { temperature: 0, top_p: 1, seed, num_predict: 64 },
  };
  const t0 = performance.now();
  let r = await fetch(host() + "/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
  });
  if (r.status === 400) { // modelo sem suporte ao campo "think"
    delete corpo.think;
    r = await fetch(host() + "/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
    });
  }
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  return { letra: extraiLetra(j.message?.content), s: (performance.now() - t0) / 1000 };
}

document.getElementById("btn-rodar").addEventListener("click", async () => {
  const modelos = [...document.querySelectorAll("#modelos-lista input:checked")].map((c) => c.value).slice(0, 3);
  if (!modelos.length) return status("Selecione ao menos um modelo.");
  const runs = +document.getElementById("runs").value;
  const btn = document.getElementById("btn-rodar");
  btn.disabled = true;

  const resultados = [];
  for (const modelo of modelos) {
    const detalhes = [];
    let tempo = 0, acertos = 0;
    for (const q of BENCH.questoes) {
      const letras = [], tempos = [];
      for (let i = 0; i < runs; i++) {
        status(`${modelo} · ${q.id} · run ${i + 1}/${runs}`);
        try {
          const { letra, s } = await perguntaModelo(modelo, q, 42 + i);
          letras.push(letra); tempos.push(s); tempo += s;
        } catch (e) { letras.push(null); tempos.push(0); }
      }
      const certas = letras.filter((l) => l === q.resposta).length;
      acertos += certas;
      const moda = letras.filter(Boolean).sort(
        (a, b) => letras.filter((x) => x === b).length - letras.filter((x) => x === a).length)[0] || null;
      detalhes.push({
        questao: q.id, gabarito: q.resposta, respostas: letras, resposta_moda: moda,
        acertos: certas, correta: certas > runs / 2,
        latencia_media_s: +(tempos.reduce((a, b) => a + b, 0) / runs).toFixed(3),
      });
    }
    const total = BENCH.questoes.length * runs;
    resultados.push({
      modelo, runs, acuracia: +(acertos / total).toFixed(4), acertos, total,
      latencia_media_s: +(tempo / total).toFixed(3), detalhes,
    });
  }

  resultados.sort((a, b) => b.acuracia - a.acuracia);
  ULTIMO_VIVO = {
    benchmark_id: BENCH.id, benchmark_versao: BENCH.version,
    executado_em: new Date().toISOString(), host: host(), runs, metrica: "acuracia", resultados,
  };

  document.getElementById("cartao-vivo").style.display = "";
  document.getElementById("nota-vivo").textContent =
    `${modelos.length} modelo(s) · ${runs} repetição(ões) por questão · ${new Date().toLocaleString("pt-BR")}`;
  desenhaGrafico(document.getElementById("grafico-vivo"), resultados);
  desenhaMatriz(document.getElementById("tabela-vivo"), ULTIMO_VIVO);
  status("Concluído.");
  btn.disabled = false;
});

document.getElementById("btn-baixar").addEventListener("click", () => {
  if (!ULTIMO_VIVO) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(ULTIMO_VIVO, null, 2)], { type: "application/json" }));
  a.download = "results.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

/* ---------------- boot ---------------- */
(async function init() {
  BENCH = await (await fetch("benchmark.json")).json();
  desenhaQuestoes();
  try {
    const dados = await (await fetch("results.json")).json();
    document.getElementById("nota-exec").textContent =
      `Execução de ${new Date(dados.executado_em).toLocaleString("pt-BR")} · ${dados.runs} repetições por questão · ${BENCH.questoes.length} questões`;
    desenhaGrafico(document.getElementById("grafico-acuracia"), dados.resultados);
    desenhaLegenda(document.getElementById("legenda-modelos"), dados.resultados);
    desenhaTiles(document.getElementById("tiles-resumo"), dados);
    desenhaMatriz(document.getElementById("tabela-matriz"), dados);
    try {
      const shuf = await (await fetch("results_shuffle.json")).json();
      if (desenhaRobustez(dados, shuf)) desenhaLetras(shuf);
    } catch (_) { /* execução com permutação é opcional */ }
  } catch (e) {
    document.getElementById("nota-exec").textContent =
      "Nenhum results.json encontrado. Rode `python3 bench/run_bench.py` ou use a aba “Executar ao vivo”.";
  }
})();
