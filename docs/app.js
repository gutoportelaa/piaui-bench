/* PiauíBench — app estático: mostra resultados pré-computados e roda o
   benchmark ao vivo contra um Ollama local a partir do navegador. */

const LETRAS = ["A", "B", "C", "D", "E"];
const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
const corDe = (i) => SERIES[i % SERIES.length];
const pct = (v) => (v * 100).toFixed(1) + "%";

const CHAVE_LS = "piauibench.questoes.v1";

let BENCH = null;          // benchmark.json publicado (nunca mutado)
let PERSONALIZADAS = [];   // questões criadas pelo usuário, salvas no navegador
let ULTIMO_VIVO = null;
let EDITANDO = null;       // id da questão em edição, ou null

/* Conjunto efetivamente usado na execução ao vivo e na aba Questões. */
const questoesAtivas = () => [...BENCH.questoes, ...PERSONALIZADAS];

const escapa = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------- abas ---------------- */
document.querySelectorAll(".abas button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".abas button").forEach((b) => b.setAttribute("aria-selected", "false"));
    btn.setAttribute("aria-selected", "true");
    document.querySelectorAll(".painel").forEach((p) => p.classList.remove("ativo"));
    document.getElementById("painel-" + btn.dataset.painel).classList.add("ativo");
    document.getElementById("rota-secao").textContent = btn.textContent.trim().toLowerCase();
  });
});

/* Sonda o Ollama local só para acender o LED da barra de sistema. */
async function sondaOllama() {
  const led = document.getElementById("led-ollama");
  const txt = document.getElementById("txt-ollama");
  try {
    const r = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(2500) });
    const { models } = await r.json();
    led.className = "led on";
    txt.textContent = `online · ${models.length} modelos`;
  } catch (_) {
    led.className = "led off";
    txt.textContent = "offline";
  }
}

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
function desenhaMatriz(tabela, dados, questoes = BENCH.questoes) {
  const cab = dados.resultados
    .map((r, i) => `<th class="centro"><span class="chip" style="background:${corDe(i)};display:inline-block"></span> ${r.modelo}</th>`)
    .join("");

  const linhas = questoes.map((q) => {
    const celulas = dados.resultados.map((r) => {
      const d = r.detalhes.find((x) => x.questao === q.id);
      if (!d) return `<td class="centro">—</td>`;
      const ok = d.correta;
      return `<td class="centro"><span class="marca ${ok ? "ok" : "nao"}">${ok ? "✓" : "✗"}</span>
              <span style="color:var(--text-muted)"> ${d.resposta_moda || "?"}</span></td>`;
    }).join("");
    return `<tr>
      <td><strong>${escapa(q.id)}</strong> <span class="tag">${escapa(q.categoria)}</span><div class="q-txt" style="color:var(--text-secondary);font-size:.85rem;margin-top:3px">${escapa(q.pergunta)}</div></td>
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
  document.getElementById("lista-questoes").innerHTML = questoesAtivas().map((q) => `
    <div class="questao">
      <span class="tag">${escapa(q.id)} · ${escapa(q.categoria)}</span>
      ${q.personalizada ? '<span class="tag tag-custom">sua questão</span>' : ""}
      <h3>${escapa(q.pergunta)}</h3>
      <ol type="A">
        ${LETRAS.map((l) => `<li class="${l === q.resposta ? "certa" : ""}">${escapa(q.alternativas[l])}${l === q.resposta ? " ✓" : ""}</li>`).join("")}
      </ol>
      <div class="fonte">Fonte: ${escapa(q.fonte) || "—"}</div>
    </div>`).join("");
}

/* ---------------- editor de questões ---------------- */
function carregaPersonalizadas() {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE_LS) || "[]");
    PERSONALIZADAS = Array.isArray(bruto) ? bruto.filter(validaEstrutura) : [];
  } catch (_) { PERSONALIZADAS = []; }
}

function salvaPersonalizadas() {
  localStorage.setItem(CHAVE_LS, JSON.stringify(PERSONALIZADAS));
  desenhaQuestoes();
  desenhaCustom();
}

function validaEstrutura(q) {
  return q && typeof q.pergunta === "string" && q.alternativas &&
    LETRAS.every((l) => typeof q.alternativas[l] === "string") && LETRAS.includes(q.resposta);
}

function proximoId() {
  const usados = new Set([...BENCH.questoes, ...PERSONALIZADAS].map((q) => q.id));
  let n = 1;
  while (usados.has(`C${String(n).padStart(2, "0")}`)) n++;
  return `C${String(n).padStart(2, "0")}`;
}

function montaCamposAlternativas() {
  document.getElementById("campos-alternativas").innerHTML = LETRAS.map((l) => `
    <div class="linha-alt">
      <input type="radio" name="correta" value="${l}" id="r-${l}" required>
      <label class="letra" for="r-${l}">${l}</label>
      <input type="text" id="f-alt-${l}" placeholder="Alternativa ${l}" required>
    </div>`).join("");
}

function preencheForm(q) {
  document.getElementById("f-id").value = q?.id || "";
  document.getElementById("f-pergunta").value = q?.pergunta || "";
  document.getElementById("f-categoria").value = q?.categoria || "";
  document.getElementById("f-fonte").value = q?.fonte || "";
  LETRAS.forEach((l) => {
    document.getElementById(`f-alt-${l}`).value = q?.alternativas?.[l] || "";
    document.getElementById(`r-${l}`).checked = q?.resposta === l;
  });
  EDITANDO = q?.id || null;
  document.getElementById("btn-salvar").textContent = q ? "Salvar alterações" : "Adicionar questão";
  document.getElementById("btn-cancelar").style.display = q ? "" : "none";
  document.getElementById("erro-form").textContent = "";
}

function leForm() {
  const alternativas = Object.fromEntries(
    LETRAS.map((l) => [l, document.getElementById(`f-alt-${l}`).value.trim()]));
  return {
    id: EDITANDO || proximoId(),
    categoria: document.getElementById("f-categoria").value.trim() || "Geral",
    pergunta: document.getElementById("f-pergunta").value.trim(),
    alternativas,
    resposta: document.querySelector('input[name="correta"]:checked')?.value || null,
    fonte: document.getElementById("f-fonte").value.trim(),
    personalizada: true,
  };
}

function valida(q) {
  if (q.pergunta.length < 10) return "Escreva a pergunta (mínimo 10 caracteres).";
  const vazias = LETRAS.filter((l) => !q.alternativas[l]);
  if (vazias.length) return `Preencha todas as alternativas — faltam: ${vazias.join(", ")}.`;
  const textos = LETRAS.map((l) => q.alternativas[l].toLowerCase());
  if (new Set(textos).size !== 5) return "Há alternativas repetidas — as cinco devem ser distintas.";
  if (!q.resposta) return "Marque qual alternativa é a correta.";
  return null;
}

function desenhaCustom() {
  const alvo = document.getElementById("lista-custom");
  document.getElementById("contador-custom").textContent = PERSONALIZADAS.length;
  if (!PERSONALIZADAS.length) {
    alvo.innerHTML = `<p class="nota" style="margin:0">Nenhuma questão sua ainda. As 10 oficiais continuam valendo.</p>`;
    return;
  }
  alvo.innerHTML = PERSONALIZADAS.map((q) => `
    <div class="questao">
      <div class="linha-topo-custom">
        <span><span class="tag">${escapa(q.id)} · ${escapa(q.categoria)}</span></span>
        <span>
          <button class="acao sec mini" data-compartilhar="${escapa(q.id)}">Compartilhar</button>
          <button class="acao sec mini" data-editar="${escapa(q.id)}">Editar</button>
          <button class="acao sec mini" data-remover="${escapa(q.id)}">Remover</button>
        </span>
      </div>
      <h3>${escapa(q.pergunta)}</h3>
      <ol type="A">
        ${LETRAS.map((l) => `<li class="${l === q.resposta ? "certa" : ""}">${escapa(q.alternativas[l])}${l === q.resposta ? " ✓" : ""}</li>`).join("")}
      </ol>
      ${q.fonte ? `<div class="fonte">Fonte: ${escapa(q.fonte)}</div>` : ""}
    </div>`).join("");

  alvo.querySelectorAll("[data-compartilhar]").forEach((b) => b.addEventListener("click", () =>
    abreIssue([PERSONALIZADAS.find((q) => q.id === b.dataset.compartilhar)])));
  alvo.querySelectorAll("[data-editar]").forEach((b) => b.addEventListener("click", () => {
    preencheForm(PERSONALIZADAS.find((q) => q.id === b.dataset.editar));
    document.getElementById("f-pergunta").scrollIntoView({ behavior: "smooth", block: "center" });
  }));
  alvo.querySelectorAll("[data-remover]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm(`Remover a questão ${b.dataset.remover}?`)) return;
    PERSONALIZADAS = PERSONALIZADAS.filter((q) => q.id !== b.dataset.remover);
    if (EDITANDO === b.dataset.remover) preencheForm(null);
    salvaPersonalizadas();
  }));
}

const REPO = "gutoportelaa/piaui-bench";

/* ---- compartilhamento por link (sem conta, sem servidor) ----
   As questões viajam codificadas no fragmento da URL (#q=…). O fragmento nunca
   é enviado ao servidor pelo navegador, então o link funciona até offline. */
function paraBase64(texto) {
  const bytes = new TextEncoder().encode(texto);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deBase64(b64) {
  const normal = b64.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(normal + "=".repeat((4 - normal.length % 4) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function geraLink(questoes) {
  const limpas = questoes.filter(Boolean).map(({ personalizada, ...q }) => q);
  const base = location.origin + location.pathname;
  return base + "#q=" + paraBase64(JSON.stringify(limpas));
}

/* Se a página abriu com #q=…, oferece importar as questões que vieram no link. */
function importaDoLink() {
  const achado = location.hash.match(/[#&]q=([A-Za-z0-9\-_]+)/);
  if (!achado) return;
  history.replaceState(null, "", location.pathname);  // limpa a URL

  let recebidas;
  try {
    recebidas = JSON.parse(deBase64(achado[1]));
  } catch (_) {
    return;
  }
  const validas = (Array.isArray(recebidas) ? recebidas : []).filter(validaEstrutura);
  if (!validas.length) return;

  const jaTenho = new Set(questoesAtivas().map((q) => q.pergunta.trim().toLowerCase()));
  const novas = validas.filter((q) => !jaTenho.has(q.pergunta.trim().toLowerCase()));
  if (!novas.length) {
    return alert(`O link trazia ${validas.length} questão(ões), todas já presentes aqui.`);
  }
  if (!confirm(`Este link traz ${novas.length} questão(ões) nova(s). Adicionar ao seu conjunto?`)) return;

  novas.forEach((q) => {
    const { personalizada, ...limpa } = q;
    limpa.id = proximoId();
    limpa.personalizada = true;
    PERSONALIZADAS.push(limpa);
  });
  salvaPersonalizadas();
  document.querySelector('[data-painel="editor"]').click();
  document.getElementById("status-editor").textContent =
    `${novas.length} questão(ões) importada(s) do link. Conjunto ativo: ${questoesAtivas().length}.`;
}

/* Compartilhamento sem backend: abre uma issue do GitHub já preenchida.
   O site é estático e não pode gravar nada — o repositório é o banco de dados. */
function abreIssue(questoes) {
  const limpas = questoes.filter(Boolean).map(({ personalizada, ...q }) => q);
  if (!limpas.length) return;

  const titulo = limpas.length === 1
    ? `[questão] ${limpas[0].pergunta.slice(0, 70)}`
    : `[questão] ${limpas.length} novas questões`;

  const corpo = [
    limpas.length === 1
      ? "Proposta de questão para o benchmark, gerada pelo editor da aplicação."
      : `Proposta de ${limpas.length} questões, geradas pelo editor da aplicação.`,
    "", "```json", JSON.stringify(limpas, null, 2), "```", "",
    "**Fontes:** " + (limpas.map((q) => q.fonte).filter(Boolean).join(" · ") || "_não informada_"),
    "", "<sub>Critérios de aceite: alternativas plausíveis e do mesmo tipo, gabarito único e verificável pela fonte.</sub>",
  ].join("\n");

  const url = `https://github.com/${REPO}/issues/new` +
    `?labels=questao&title=${encodeURIComponent(titulo)}&body=${encodeURIComponent(corpo)}`;

  if (url.length > 7500) {
    baixa("questoes-novas.json", limpas);
    return alert("O conjunto ficou grande demais para a URL da issue.\n" +
      "Baixei o JSON — anexe-o à issue manualmente.");
  }
  window.open(url, "_blank", "noopener");
}

function baixa(nome, obj) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }));
  a.download = nome;
  a.click();
  URL.revokeObjectURL(a.href);
}

function ligaEditor() {
  montaCamposAlternativas();
  preencheForm(null);
  desenhaCustom();
  const aviso = (msg) => (document.getElementById("status-editor").textContent = msg);

  document.getElementById("form-questao").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const q = leForm();
    const erro = valida(q);
    if (erro) return (document.getElementById("erro-form").textContent = erro);
    const idx = PERSONALIZADAS.findIndex((x) => x.id === q.id);
    if (idx >= 0) PERSONALIZADAS[idx] = q; else PERSONALIZADAS.push(q);
    salvaPersonalizadas();
    preencheForm(null);
    aviso(`Questão ${q.id} salva. Total ativo: ${questoesAtivas().length} questões.`);
  });

  document.getElementById("btn-cancelar").addEventListener("click", () => preencheForm(null));

  document.getElementById("btn-exemplo").addEventListener("click", () => {
    preencheForm({
      categoria: "Cultura",
      pergunta: "Qual município piauiense é conhecido como a capital brasileira da opala?",
      alternativas: { A: "Piripiri", B: "Pedro II", C: "Campo Maior", D: "Barras", E: "Valença do Piauí" },
      resposta: "B",
      fonte: "Governo do Estado do Piauí — polo gemológico de Pedro II",
    });
    EDITANDO = null;
    document.getElementById("btn-salvar").textContent = "Adicionar questão";
    document.getElementById("btn-cancelar").style.display = "none";
  });

  document.getElementById("btn-link").addEventListener("click", async () => {
    if (!PERSONALIZADAS.length) return aviso("Nenhuma questão sua para compartilhar.");
    const link = geraLink(PERSONALIZADAS);
    if (link.length > 12000) {
      baixa("questoes-novas.json", PERSONALIZADAS.map(({ personalizada, ...q }) => q));
      return aviso("Conjunto grande demais para um link — baixei o JSON para enviar como arquivo.");
    }
    try {
      await navigator.clipboard.writeText(link);
      aviso(`Link com ${PERSONALIZADAS.length} questão(ões) copiado (${link.length} caracteres). Envie para quem vai executar.`);
    } catch (_) {
      prompt("Copie o link e envie para quem vai executar o benchmark:", link);
      aviso(`Link com ${PERSONALIZADAS.length} questão(ões) gerado — copie da caixa acima.`);
    }
  });

  document.getElementById("btn-enviar-todas").addEventListener("click", () => {
    if (!PERSONALIZADAS.length) return aviso("Nenhuma questão sua para compartilhar.");
    abreIssue(PERSONALIZADAS);
    aviso("Issue aberta em nova aba — revise e publique para propor as questões.");
  });

  document.getElementById("btn-exportar").addEventListener("click", () => {
    baixa("benchmark.json", {
      ...BENCH,
      version: BENCH.version + "+local",
      questoes: questoesAtivas().map(({ personalizada, ...q }) => q),
    });
    aviso("benchmark.json baixado — substitua docs/benchmark.json no repositório.");
  });

  document.getElementById("btn-copiar").addEventListener("click", async () => {
    const texto = JSON.stringify(PERSONALIZADAS.map(({ personalizada, ...q }) => q), null, 2);
    try {
      await navigator.clipboard.writeText(texto);
      aviso(`${PERSONALIZADAS.length} questão(ões) copiada(s) para a área de transferência.`);
    } catch (_) {
      baixa("questoes-novas.json", PERSONALIZADAS.map(({ personalizada, ...q }) => q));
      aviso("Sem permissão de clipboard — baixei como arquivo.");
    }
  });

  /* Aceita vários arquivos de uma vez: em sala, o host recebe um JSON por aluno. */
  document.getElementById("f-importar").addEventListener("change", async (ev) => {
    const arquivos = [...ev.target.files];
    if (!arquivos.length) return;

    let lidas = 0, invalidas = 0, repetidas = 0, adicionadas = 0;
    const falhas = [];

    for (const arquivo of arquivos) {
      let lista;
      try {
        const dados = JSON.parse(await arquivo.text());
        lista = Array.isArray(dados) ? dados : dados.questoes || [];
      } catch (e) {
        falhas.push(arquivo.name);
        continue;
      }
      lidas += lista.length;
      for (const q of lista) {
        if (!validaEstrutura(q)) { invalidas++; continue; }
        // Deduplica pelo enunciado contra tudo que já está ativo.
        const chave = q.pergunta.trim().toLowerCase();
        if (questoesAtivas().some((x) => x.pergunta.trim().toLowerCase() === chave)) { repetidas++; continue; }
        const { personalizada, ...limpa } = q;
        limpa.id = proximoId();
        limpa.personalizada = true;
        PERSONALIZADAS.push(limpa);
        adicionadas++;
      }
    }
    salvaPersonalizadas();
    aviso(`${arquivos.length} arquivo(s) · ${lidas} questões lidas → ${adicionadas} adicionadas ` +
      `(${repetidas} repetidas, ${invalidas} inválidas` +
      `${falhas.length ? `, ilegíveis: ${falhas.join(", ")}` : ""}).`);
    ev.target.value = "";
  });

  document.getElementById("btn-limpar").addEventListener("click", () => {
    if (!PERSONALIZADAS.length || !confirm(`Apagar as ${PERSONALIZADAS.length} questões salvas neste navegador?`)) return;
    PERSONALIZADAS = [];
    preencheForm(null);
    salvaPersonalizadas();
    aviso("Questões locais apagadas. As 10 oficiais continuam.");
  });
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

/* Mesma lógica de gera_variante() do runner Python — ver bench/run_bench.py. */
function geraVariante(q, r, modo) {
  if (modo === "fixa") return q;
  const valores = LETRAS.map((l) => q.alternativas[l]);
  const correta = q.alternativas[q.resposta];
  const d = r % LETRAS.length;
  const rot = valores.slice(d).concat(valores.slice(0, d));
  return {
    ...q,
    alternativas: Object.fromEntries(LETRAS.map((l, i) => [l, rot[i]])),
    resposta: LETRAS[rot.indexOf(correta)],
  };
}

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
  const modo = document.getElementById("modo").value;
  const btn = document.getElementById("btn-rodar");
  btn.disabled = true;

  const questoes = questoesAtivas();
  const resultados = [];
  for (const modelo of modelos) {
    const detalhes = [];
    let tempo = 0, acertos = 0;
    for (const q of questoes) {
      const letras = [], tempos = [];
      for (let i = 0; i < runs; i++) {
        status(`${modelo} · ${q.id} · chamada ${i + 1}/${runs} (ordem ${modo})`);
        const qv = geraVariante(q, i, modo);
        try {
          const { letra, s } = await perguntaModelo(modelo, qv, 42 + i);
          // Normaliza para o espaço de letras original, como faz o runner Python.
          const texto = letra ? qv.alternativas[letra] : null;
          letras.push(LETRAS.find((l) => q.alternativas[l] === texto) ?? null);
          tempos.push(s); tempo += s;
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
    const total = questoes.length * runs;
    resultados.push({
      modelo, runs, modo, acuracia: +(acertos / total).toFixed(4), acertos, total,
      latencia_media_s: +(tempo / total).toFixed(3), detalhes,
    });
  }

  resultados.sort((a, b) => b.acuracia - a.acuracia);
  ULTIMO_VIVO = {
    benchmark_id: BENCH.id, benchmark_versao: BENCH.version,
    executado_em: new Date().toISOString(), host: host(), runs, modo, metrica: "acuracia", resultados,
  };

  document.getElementById("cartao-vivo").style.display = "";
  document.getElementById("nota-vivo").textContent =
    `${modelos.length} modelo(s) · ${questoes.length} questões (${PERSONALIZADAS.length} suas) · ` +
    `ordem ${modo} · ${runs} chamada(s) por questão · ` +
    `${modelos.length * questoes.length * runs} chamadas no total · ${new Date().toLocaleString("pt-BR")}`;
  desenhaGrafico(document.getElementById("grafico-vivo"), resultados);
  desenhaMatriz(document.getElementById("tabela-vivo"), ULTIMO_VIVO, questoes);
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
  carregaPersonalizadas();
  ligaEditor();
  desenhaQuestoes();
  importaDoLink();
  sondaOllama();
  try {
    const dados = await (await fetch("results.json")).json();
    document.getElementById("nota-exec").textContent =
      `Execução de ${new Date(dados.executado_em).toLocaleString("pt-BR")} · ${dados.runs} repetições por questão · ${BENCH.questoes.length} questões`;
    document.getElementById("txt-exec").textContent =
      "última execução: " + new Date(dados.executado_em).toLocaleString("pt-BR");
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
