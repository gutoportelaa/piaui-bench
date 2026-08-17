# PiauíBench

Benchmark de **10 questões de múltipla escolha (5 alternativas)** sobre o Estado do Piauí,
usado para comparar a **acurácia** de três LLMs pequenos executados localmente no
[Ollama](https://ollama.com), com uma aplicação web publicada no GitHub Pages.

**Aplicação:** https://gutoportelaa.github.io/piaui-bench/

---

## Resultados

Execução real em RTX 4070 Laptop (8 GB), Ollama 0.22, `temperature=0`, 3 repetições por questão:

| Modelo | Família | Params | Acurácia (ordem fixa) | Acurácia (alternativas permutadas) | Latência/resposta |
|---|---|---|---|---|---|
| `llama3.2:3b` | Meta | 3,2 B | **50,0 %** | **48,0 %** | 0,34 s |
| `qwen3:4b`    | Alibaba | 4,0 B | 40,0 % | 28,0 % | 0,54 s |
| `gemma3:4b`   | Google | 4,3 B | 30,0 % | 22,0 % | 0,82 s |

Baseline aleatório: **20 %**.

### O achado principal

A comparação entre as duas colunas é mais informativa que a acurácia isolada.
Ao **permutar as alternativas** a cada repetição, `qwen3:4b` cai 12 p.p. e `gemma3:4b`
cai 8 p.p. — ambos ficando a poucos pontos do acaso —, enquanto `llama3.2:3b` se mantém.

Isso indica **viés de seleção posicional**, não conhecimento. O caso mais claro:

```
$ ollama run gemma3:4b "Qual é a capital do Piauí? Responda em uma palavra."
Teresina.                       # ✅ sabe a resposta

# mesma pergunta em múltipla escolha (A) Parnaíba (B) Teresina (C) Picos ...
→ A                             # ❌ escolhe a primeira alternativa
```

A distribuição das letras escolhidas confirma o padrão: sob permutação, `qwen3:4b`
escolheu "B" em 44 % das respostas e `gemma3:4b` escolheu "C" em 36 % — longe dos 20 %
esperados de um modelo sem viés. É o efeito descrito por
[Zheng et al. (2023)](https://arxiv.org/abs/2309.05463), e é a razão de o projeto reportar
as duas medidas lado a lado.

---

## Modelos pequenos que rodam bem no Ollama

Todos cabem em GPU de 6–8 GB (quantização Q4 padrão) ou rodam em CPU.

### Os três avaliados aqui

| Comando | Empresa | Params | Disco | Observações |
|---|---|---|---|---|
| `ollama pull llama3.2:3b` | Meta | 3,2 B | 2,0 GB | Contexto 128k, suporta *tools*. Melhor resultado neste benchmark |
| `ollama pull qwen3:4b` | Alibaba | 4,0 B | 2,5 GB | Modo de raciocínio híbrido (desligue com `think: false`) |
| `ollama pull gemma3:4b` | Google | 4,3 B | 3,3 GB | Multimodal (texto + imagem), 128k de contexto |

> **Nota sobre o enunciado:** não existe "Qwen3.5". A Alibaba publicou **Qwen2.5**
> (0,5 B / 1,5 B / 3 B / 7 B) e **Qwen3** (0,6 B / 1,7 B / 4 B / 8 B). Este projeto usa Qwen3 4B.

### Outras opções para ampliar a comparação

| Comando | Empresa | Params | Disco |
|---|---|---|---|
| `ollama pull llama3.2:1b` | Meta | 1,2 B | 1,3 GB |
| `ollama pull qwen3:1.7b` | Alibaba | 1,7 B | 1,4 GB |
| `ollama pull qwen2.5:3b` | Alibaba | 3,1 B | 1,9 GB |
| `ollama pull gemma3:1b` | Google | 1,0 B | 815 MB |
| `ollama pull phi4-mini` | Microsoft | 3,8 B | 2,5 GB |
| `ollama pull granite3.3:2b` | IBM | 2,5 B | 1,5 GB |
| `ollama pull smollm2:1.7b` | Hugging Face | 1,7 B | 1,8 GB |
| `ollama pull ministral` / `mistral:7b` | Mistral AI | 8 B / 7 B | ~4,4 GB |
| `ollama pull deepseek-r1:1.5b` | DeepSeek | 1,5 B | 1,1 GB |

Para português especificamente, vale testar também
[`cnmoro/sabia`](https://huggingface.co/maritaca-ai) (Maritaca AI) e modelos GGUF da
comunidade via `ollama run hf.co/<usuario>/<repo>`.

---

## Como reproduzir

```bash
git clone https://github.com/gutoportelaa/piaui-bench
cd piaui-bench

# 1. baixar os modelos
ollama pull llama3.2:3b
ollama pull qwen3:4b
ollama pull gemma3:4b

# 2. rodar o benchmark (sem dependências além do Python 3.10+)
python3 bench/run_bench.py --runs 3
python3 bench/run_bench.py --runs 5 --shuffle --out docs/results_shuffle.json

# 3. abrir a aplicação
python3 -m http.server -d docs 8000    # http://localhost:8000
```

Opções do runner:

```
--models M1 M2 M3   modelos a avaliar (default: llama3.2:3b qwen3:4b gemma3:4b)
--runs N            repetições por questão (default: 3)
--shuffle           permuta as alternativas a cada repetição
--host URL          endereço do Ollama (default: http://localhost:11434)
--out CAMINHO       arquivo JSON de saída
```

---

## Estrutura

```
bench/run_bench.py        runner CLI → gera docs/results*.json
docs/benchmark.json       as 10 questões, gabarito e fonte de cada uma
docs/results.json         resultados com ordem fixa das alternativas
docs/results_shuffle.json resultados com alternativas permutadas
docs/index.html|app.js|style.css   aplicação web (GitHub Pages)
```

O site é 100 % estático — sem build, sem dependências, sem CDN.
A aba **Executar ao vivo** roda o benchmark no navegador contra o Ollama da própria máquina
(nada sai do computador) e permite baixar o `results.json` gerado.

---

## Metodologia

- **Tarefa:** MCQA fechada, sem contexto recuperado — mede conhecimento paramétrico regional em pt-BR.
- **Decodificação:** `temperature=0`, `top_p=1`, `seed` fixa, `think: false`.
- **Saída estruturada:** parâmetro `format` do Ollama com schema JSON e
  `enum: ["A","B","C","D","E"]`. Isso separa *erro de conhecimento* de *erro de formatação* —
  sem isso, parte da "queda de acurácia" seria só o parser falhando.
- **Repetições:** cada questão é feita *n* vezes com sementes distintas; a resposta exibida é a moda,
  e a acurácia global usa todas as chamadas.
- **Métrica:** acurácia = acertos / total de chamadas.
- **Fontes do gabarito:** IBGE, ICMBio, IPHAN e UNESCO (cada questão traz sua fonte no JSON).

### Limitações

Com 10 itens, cada questão vale 10 p.p. e o intervalo de confiança é largo — o resultado
é indicativo, não conclusivo. Para tornar as conclusões mais robustas:

1. Ampliar para 100–200 questões com estratificação por categoria.
2. Reportar a acurácia média sobre **todas as permutações cíclicas** das alternativas.
3. Comparar com *log-likelihood scoring* das alternativas (como no MMLU), além da geração livre.
4. Incluir uma condição *open-ended* com avaliação por juiz, para medir o conhecimento sem o efeito do formato.

---

## Projetos e benchmarks similares

**Frameworks de avaliação**
- [EleutherAI — lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness) — padrão de fato; tem backend para modelos locais
- [Stanford HELM](https://github.com/stanford-crfm/helm) — avaliação multidimensional
- [OpenAI Evals](https://github.com/openai/evals) — escrita de evals customizadas
- [promptfoo](https://github.com/promptfoo/promptfoo) — comparação lado a lado, suporta Ollama nativamente
- [DeepEval](https://github.com/confident-ai/deepeval) — testes unitários para LLMs

**Benchmarks de múltipla escolha**
- [MMLU](https://arxiv.org/abs/2009.03300) — 57 tarefas, 4 alternativas; o desenho base deste projeto
- [ARC](https://allenai.org/data/arc), [TruthfulQA](https://github.com/sylinrl/TruthfulQA), [MMLU-Pro](https://arxiv.org/abs/2406.01574) (10 alternativas)

**Benchmarks em português**
- [Open PT-LLM Leaderboard](https://github.com/eduagarcia/open_pt_llm_leaderboard) — ENEM, BLUEX, OAB, ASSIN2
- [ENEM Challenge](https://arxiv.org/abs/2303.17003) — LLMs no ENEM
- [Poeta / Napolab](https://github.com/ruanchaves/napolab) — coleção de benchmarks em pt-BR
- [BLUEX](https://github.com/portuguese-benchmark-datasets/bluex) — vestibulares UNICAMP/USP

**Interfaces web para modelos locais** (referência de UI)
- [Open WebUI](https://github.com/open-webui/open-webui), [LibreChat](https://github.com/danny-avila/LibreChat), [Chatbot Arena](https://lmarena.ai) (comparação pareada)

**Sobre o viés medido aqui**
- [Zheng et al. (2023) — LLMs Are Not Robust Multiple Choice Selectors](https://arxiv.org/abs/2309.05463)
- [Pezeshkpour & Hruschka (2023) — Sensitivity to the Order of Options](https://arxiv.org/abs/2308.11483)

---

## Licença

Código sob MIT. As questões foram elaboradas a partir de fontes públicas (IBGE, ICMBio, IPHAN, UNESCO),
citadas item a item em `docs/benchmark.json`.
