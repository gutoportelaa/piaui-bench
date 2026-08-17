# PiauíBench

Benchmark de **10 questões de múltipla escolha (5 alternativas)** sobre o Estado do Piauí,
usado para comparar a **acurácia** de três LLMs pequenos executados localmente no
[Ollama](https://ollama.com), com uma aplicação web publicada no GitHub Pages.

**Aplicação:** https://gutoportelaa.github.io/piaui-bench/

---

## Resultados

`temperature=0`. Ordem fixa = 1 chamada por questão; ordem cíclica = 5 chamadas, com o gabarito
visitando cada posição exatamente uma vez.

| Modelo | Família | Params | Acurácia (fixa) | Acurácia (cíclica) | Δ | Acima do acaso |
|---|---|---|---|---|---|---|
| `llama3.2:3b` | Meta | 3,2 B | 50,0 % | **38,0 %** | −12,0 p.p. | +18,0 p.p. |
| `qwen3:4b`    | Alibaba | 4,0 B | 40,0 % | 36,0 % | −4,0 p.p. | +16,0 p.p. |
| `gemma3:4b`   | Google | 4,3 B | 30,0 % | 24,0 % | −6,0 p.p. | +4,0 p.p. |

Baseline aleatório: **20 %**. Latência: 0,35–0,70 s por resposta na RTX 4070; 1,7–5,1 s na CPU do
runner do GitHub.

> **A cíclica é a medida boa.** Os três modelos caem quando a posição do gabarito deixa de ajudar,
> e o `llama3.2:3b` — que parecia imune sob permutação aleatória com 3 amostras — cai 12 p.p. sob
> cobertura completa das 5 posições. A amostragem aleatória subestimava o viés porque não garantia
> que cada posição fosse testada. Sob a medida corrigida, a distância entre `llama3.2:3b` e
> `qwen3:4b` cai de 10 p.p. para 2 p.p., que com 10 questões **não é diferença significativa**.
>
> **Reprodutibilidade:** `temperature=0` e `seed` fixa dão determinismo *na mesma máquina*, mas CPU
> e CUDA fazem aritmética de ponto flutuante diferente — o `gemma3:4b` já variou uma questão entre
> os dois ambientes. Com 10 itens isso é ruído esperado.

### O achado principal

A comparação entre as duas colunas é mais informativa que a acurácia isolada. **Os três modelos
caem** quando o gabarito deixa de ficar parado numa posição — de 4 a 12 pontos percentuais.
Parte do que a ordem fixa media não era conhecimento, e sim **viés de seleção posicional**.

O caso mais claro:

```
$ ollama run gemma3:4b "Qual é a capital do Piauí? Responda em uma palavra."
Teresina.                       # ✅ sabe a resposta

# mesma pergunta em múltipla escolha (A) Parnaíba (B) Teresina (C) Picos ...
→ A                             # ❌ escolhe a primeira alternativa
```

A distribuição das letras confirma o padrão. Sob rotação cíclica o gabarito ocupa cada posição
exatamente 20 % das vezes, então um modelo sem viés responderia ~20 % em cada letra; na prática,
`llama3.2:3b` escolheu "B" em 38 % das respostas, `gemma3:4b` escolheu "A" em 30 % e `qwen3:4b`
escolheu "B" em 28 %. É o efeito descrito por
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
python3 bench/run_bench.py --modo fixa    --runs 1
python3 bench/run_bench.py --modo ciclica --runs 5 --out docs/results_shuffle.json
python3 bench/consolidar.py

# 3. abrir a aplicação
python3 -m http.server -d docs 8000    # http://localhost:8000
```

Opções do runner:

```
--models M1 M2 M3   modelos a avaliar (default: llama3.2:3b qwen3:4b gemma3:4b)
--modo MODO         ordem das alternativas: fixa (default), ciclica ou aleatoria
--runs N            chamadas por questão (use 1 com fixa, 5 com ciclica)
--host URL          endereço do Ollama (default: http://localhost:11434)
--timeout SEG       timeout por chamada (default: 180)
--out CAMINHO       arquivo JSON de saída
```

---

## Estrutura

```
bench/run_bench.py        runner CLI → gera docs/results*.json
bench/consolidar.py       funde as duas passadas → summary.json + summary.csv
docs/benchmark.json       as 10 questões, gabarito e fonte de cada uma
docs/results.json         passada de ordem fixa (1 chamada por questão)
docs/results_shuffle.json passada de ordem cíclica (5 chamadas por questão)
docs/summary.json|.csv    consolidado com variação em p.p. e viés por letra
docs/index.html|app.js|style.css   aplicação web (GitHub Pages)
```

O site é 100 % estático — sem build, sem dependências, sem CDN. Cinco abas:

| Aba | O que faz |
|---|---|
| **Resultados** | acurácia por modelo, robustez sob permutação, distribuição de letras, acerto por questão |
| **Executar ao vivo** | roda o benchmark no navegador contra o Ollama local e exporta o `results.json` |
| **Questões** | as 10 oficiais + as suas, com gabarito e fonte |
| **Adicionar questões** | editor com validação, persistência local, compartilhamento por link, import de vários arquivos |
| **Metodologia** | como a acurácia é medida e as referências |

---

## Adicionando novas questões

Há dois caminhos, e eles convergem no mesmo `docs/benchmark.json`.

### 1. Pela interface (aba "Adicionar questões")

Formulário com pergunta, categoria, as cinco alternativas, seleção do gabarito e fonte.
O que o editor faz:

- **Valida** antes de salvar: pergunta com ≥ 10 caracteres, as cinco alternativas preenchidas
  e distintas entre si, e exatamente um gabarito marcado.
- **Persiste** em `localStorage` — as questões sobrevivem ao reload, e nada trafega para servidor.
- **Gera IDs** livres de colisão (`C01`, `C02`, …), distintos dos oficiais (`Q01`–`Q10`).
- **Entra na execução ao vivo automaticamente**: o benchmark passa a rodar sobre o conjunto
  oficial + suas questões, e a tabela de acertos cresce junto.
- **Importa vários arquivos JSON de uma vez** (array de questões ou `benchmark.json` inteiro),
  deduplicando por enunciado e relatando quantas entraram, repetiram ou falharam.
- **Exporta** o `benchmark.json` completo, já sem os campos internos do editor.
- **Gera um link** com as questões codificadas no fragmento da URL, para enviar a quem vai executar.

### 2. Compartilhando com outros usuários

O site é estático: sem servidor, sem banco, sem sessão. O `localStorage` é privado do navegador —
**ninguém mais vê suas questões até que elas entrem no repositório.** O repositório *é* o banco de
dados compartilhado, e o caminho até ele não exige backend algum:

```
editor → botão "Compartilhar" → issue do GitHub já preenchida
       → revisão do gabarito contra a fonte
       → merge em docs/benchmark.json
       → CI reexecuta o benchmark
       → results.json commitado → Pages publica para todos
```

O botão monta uma URL `issues/new?title=…&body=…` com o JSON da questão e as fontes. Não pede
token, não pede login prévio, não passa por servidor intermediário. Acima de ~7,5 KB de URL
(muitas questões de uma vez) ele cai para download do JSON, porque URLs longas são truncadas.

A revisão humana entre proposta e merge é deliberada, não burocracia: **um gabarito errado
contamina a métrica de todos os modelos de uma vez**, e é indistinguível de um modelo ruim.
O campo `fonte` é o que torna isso auditável.

**Se o volume crescer**, as alternativas com backend, em ordem de esforço:

| Opção | Custo | Observação |
|---|---|---|
| GitHub Issues (atual) | zero | revisão manual; ótimo até dezenas de contribuições |
| GitHub App / Action que abre PR a partir da issue | zero | automatiza o merge após aprovação com label |
| Cloudflare Worker + D1, ou Supabase | free tier | fila real de submissões, moderação em UI própria |

Não recomendo pular para o backend antes de o gargalo ser real: ele adiciona autenticação,
moderação de spam e custo de operação para resolver um problema que hoje o GitHub resolve de graça.

### 3. Em sala de aula (turma + host único)

Cenário: os alunos criam questões nos próprios navegadores e o professor executa o Ollama ao vivo.
O gargalo é coletar as questões sem exigir conta do GitHub de cada aluno. Dois caminhos, ambos
sem servidor:

**Link (mais rápido, nada para instalar).** O aluno clica em **Gerar link com minhas questões**:
as questões viajam codificadas no fragmento da URL (`#q=…`), que o navegador nunca envia a servidor
algum. O aluno cola o link no chat da turma; o professor abre e confirma a importação. Uma questão
dá um link de ~450 caracteres; acima de ~12 KB o botão cai para download de arquivo.

**Arquivo (para turma grande).** Cada aluno usa **Baixar benchmark.json completo**; o professor
seleciona **todos os arquivos de uma vez** em *Importar JSON*. A importação deduplica por enunciado
contra o que já está ativo e relata o que entrou:

```
12 arquivo(s) · 15 questões lidas → 11 adicionadas (3 repetidas, 1 inválidas)
```

Depois, na aba **Executar ao vivo**, com o Ollama rodando na máquina do professor:
selecionar os 3 modelos, ordem **cíclica**, 5 chamadas, executar. O resultado aparece projetado
e o botão **Baixar results.json** salva a evidência da aula.

Dimensionamento, com os tempos medidos na RTX 4070 (0,35–0,70 s por resposta):

| Questões | Modelos | Chamadas (fixa + cíclica) | Tempo aproximado |
|---|---|---|---|
| 10 (só as oficiais) | 3 | 180 | ~2 min |
| 25 (10 + 15 da turma) | 3 | 450 | ~4 min |
| 40 | 3 | 720 | ~7 min |

Cabe numa aula com folga. Para projetar, rode primeiro com **ordem fixa / 1 chamada** (6× mais
rápido) e depois a cíclica — o contraste entre as duas passadas é a parte interessante da demonstração.

**Um cuidado:** questões escritas na hora não passaram por revisão de fonte. Vale rodar a aula com
elas normalmente e só depois abrir PR para as que resistirem à checagem do gabarito — senão a
métrica oficial fica contaminada por gabarito errado, que é indistinguível de modelo ruim.

### 4. Pelo repositório (persistência definitiva)

O GitHub Pages serve arquivos estáticos e **não pode gravar de volta no repositório** —
por isso o editor não "salva no site". O caminho oficial é:

```bash
# 1. exporte pelo editor e substitua o arquivo
mv ~/Downloads/benchmark.json docs/benchmark.json

# 2. regenere os resultados com o conjunto novo
python3 bench/run_bench.py --modo fixa    --runs 1
python3 bench/run_bench.py --modo ciclica --runs 5 --out docs/results_shuffle.json
python3 bench/consolidar.py

# 3. abra um Pull Request
```

O campo `fonte` de cada questão é o que torna o gabarito revisável — é o principal
critério de aceite de uma contribuição.

**Regra de qualidade dos distratores:** as cinco alternativas devem ser plausíveis e do mesmo
tipo (todas municípios, todos anos, todos rios). Distrator absurdo infla a acurácia e esconde
o que o modelo realmente sabe.

---

## Quem executa o benchmark: fila de espera ou CI?

A pergunta natural é montar uma fila em que os usuários enfileiram execuções e a máquina do
"host" (com GPU) processa. **Não recomendo essa arquitetura**, por três motivos concretos:

1. **Disponibilidade.** A fila só anda quando o host está ligado, com o Ollama de pé e a GPU livre.
   Um usuário que enfileira à noite espera até o host acordar — e não há como prometer prazo.
2. **O site não tem onde guardar a fila.** GitHub Pages é estático. Uma fila exige backend,
   e aí o backend passa a ser o problema principal do projeto, não o benchmark.
3. **Superfície de abuso.** Uma fila anônima que executa inferência na máquina de alguém é um
   caminho direto para uso indevido de recurso, e exige autenticação e rate limiting para funcionar.

**A fila já existe e é a do GitHub Actions.** O workflow `.github/workflows/benchmark.yml` instala
o Ollama no runner, baixa os modelos, roda as duas variantes e commita `results.json` de volta.
Dispara por `workflow_dispatch` (manual, com modelos e repetições como input) ou automaticamente
em push a `docs/benchmark.json` — ou seja, **questão aceita re-mede tudo sozinha.**

Medido, não estimado — runner `ubuntu-latest`, 4 vCPU, sem GPU:

| Configuração | Tempo total | Latência por resposta |
|---|---|---|
| 1 modelo × 1 repetição | 2 min 17 s | 4,4 s |
| 3 modelos, fixa (1) + cíclica (5) | ~10 min | 1,7–5,1 s |

Comparação: os mesmos 3 modelos na RTX 4070 levam 0,34–0,82 s por resposta. A CPU do runner é
~10× mais lenta, e ainda assim cabe folgadamente no limite de 6 h por job. **Para modelos até 4B,
GPU é conveniência, não requisito.**

### Quando a máquina do host é mesmo necessária

Para modelos que não cabem no runner (14B+, ou multimodais), o caminho correto é um
[self-hosted runner](https://docs.github.com/actions/hosting-your-own-runners) na máquina com GPU:

```yaml
runs-on: [self-hosted, gpu]   # em vez de ubuntu-latest
```

Isso entrega exatamente o que uma "fila para o host" entregaria — jobs enfileirados, executados na
GPU do mantenedor — mas com fila, autenticação, logs, histórico e cancelamento já resolvidos pelo
GitHub, e sem expor o Ollama à internet. O host liga a máquina quando quiser; os jobs esperam na fila.

---

## Orçamento de chamadas: quantas vezes cada pergunta é feita

Duas passadas independentes, cada uma com seu arquivo de resultados. **Por questão e por modelo:**

| Passada | Chamadas | O que muda entre elas | Arquivo |
|---|---|---|---|
| Ordem fixa | **1** | nada — medição única | `docs/results.json` |
| Ordem cíclica | **5** | a lista de alternativas rotaciona 1 posição por chamada | `docs/results_shuffle.json` |
| **Total** | **6** | — | `docs/summary.json` consolida |

Com 3 modelos: 18 chamadas por questão, **180 no benchmark de 10 questões**.

Na passada cíclica, a rotação faz o gabarito visitar cada uma das cinco letras exatamente uma vez.
Não é amostragem aleatória de permutações — é cobertura exaustiva das posições, o que elimina a
sorte no sorteio.

### Por que a ordem fixa usa 1 chamada, e não 3

Com `temperature=0` a decodificação é gulosa: o mesmo prompt produz sempre a mesma saída, e a
`seed` não muda nada. Isso foi medido, não assumido — na versão anterior, com 3 repetições de
ordem fixa, **as 3 respostas foram idênticas em 30 de 30 casos** (3 modelos × 10 questões).
Era 3× o custo por zero informação. Repetição só informa quando o prompt muda; por isso todo o
orçamento de repetição foi para as permutações.

O runner avisa se você pedir uma combinação que não faz sentido:

```
$ python3 bench/run_bench.py --modo fixa --runs 3
[aviso] modo 'fixa' com --runs 3: o prompt e identico em todas as repeticoes e
        temperature=0, entao as respostas tendem a ser iguais. Use --runs 1,
        ou --modo ciclica --runs 5.
```

## Como as chamadas viram um número

Há **duas agregações diferentes**, e elas discordam de propósito:

| | Regra | Exemplo: 1 acerto em 5 chamadas |
|---|---|---|
| **Acurácia** (métrica reportada) | acertos ÷ total de chamadas | contribui **1/5** — acerto parcial conta |
| **✓/✗ na tabela** (só exibição) | voto majoritário, `acertos > chamadas/2` | exibe **✗** |
| **Letra exibida** | resposta mais frequente, remapeada para a ordem original | a letra que mais apareceu |

Empate conta como erro no voto majoritário. Um modelo que acerta 2 de 5 posições e erra 3 não
"sabe pela metade": ele acerta quando o gabarito cai numa posição que ele favorece — exatamente
o padrão que a passada cíclica expõe e a ordem fixa esconde.

**Variação em p.p.** é subtração direta das duas acurácias: 50% → 38% é **−12,0 pontos
percentuais**, não −12%. Em variação relativa seria −24%. O consolidador grava as duas formas:

```bash
$ python3 bench/consolidar.py
| Modelo | Acurácia (fixa) | Acurácia (cíclica) | Variação | Acima do acaso | Letra dominante |
|---|---|---|---|---|---|
| `llama3.2:3b` | 50.0% | 38.0% | -12.0 p.p. | +18.0 p.p. | B (38%) |
| `qwen3:4b`    | 40.0% | 36.0% |  -4.0 p.p. | +16.0 p.p. | B (28%) |
| `gemma3:4b`   | 30.0% | 24.0% |  -6.0 p.p. |  +4.0 p.p. | A (30%) |
```

Saídas: `docs/summary.json` (com `variacao_pp`, `variacao_relativa`, `acima_do_acaso_pp` e a
concentração na letra dominante) e `docs/summary.csv` para planilha.

## Como funciona a aquisição de respostas

Pipeline idêntico no runner Python (`bench/run_bench.py`) e no navegador (`docs/app.js`) —
por isso os dois produzem os mesmos números.

**1. Montagem do prompt.** *System prompt* fixo em português definindo o papel e o formato,
mais a questão com as alternativas rotuladas A–E:

```
Você é um especialista em geografia, história e cultura do Estado do Piauí, Brasil.
Responda somente com a letra da alternativa correta (A, B, C, D ou E), sem explicação.
---
Qual é a atual capital do Estado do Piauí?

A) Parnaíba
B) Teresina
...
Responda apenas com a letra da alternativa correta.
```

**2. Chamada.** `POST /api/chat` do Ollama, `stream: false`, com:

| Parâmetro | Valor | Por quê |
|---|---|---|
| `temperature` | `0` | resposta determinística |
| `top_p` | `1` | sem truncamento de cauda |
| `seed` | `42 + r` | reprodutível, mas varia entre repetições |
| `num_predict` | `64` | a resposta é uma letra; corta divagação |
| `think` | `false` | desliga o raciocínio do Qwen3 (com *fallback* se o modelo não aceitar o campo) |
| `format` | schema JSON | restringe a saída ao conjunto válido |

**3. Restrição da saída (o ponto central).** O `format` do Ollama aplica *grammar-constrained
decoding*: o modelo é obrigado a emitir uma das cinco letras.

```json
{"type":"object","properties":{"resposta":{"type":"string","enum":["A","B","C","D","E"]}},"required":["resposta"]}
```

Sem isso, uma resposta como *"A capital é Teresina, alternativa B"* exigiria heurística de parsing,
e uma falha de formatação seria contada como erro de conhecimento. Com a restrição, **a acurácia
mede conhecimento, não obediência ao formato.**

**4. Extração com fallback.** `extrai_letra()` tenta `JSON.parse` primeiro; se falhar, remove
blocos `<think>…</think>` e busca a primeira letra isolada A–E por regex. O fallback existe
para modelos ou versões do Ollama sem suporte a saída estruturada.

**5. Normalização.** Fora do modo `fixa`, a letra vem no espaço da permutação daquela chamada.
O código a converte de volta para a letra original **buscando o texto da alternativa escolhida**
no dicionário original — sem isso as respostas não seriam comparáveis entre repetições nem
entre modelos.

**6. Agregação.** Por questão: lista de respostas, moda, nº de acertos e latência média.
`correta = acertos > runs/2` (voto majoritário). Global: acurácia sobre *todas* as chamadas,
acurácia por repetição, latência média e a distribuição das letras escolhidas — que é o
insumo da análise de viés posicional.

Erros de rede, timeout ou modelo ausente viram `null` (contado como erro) com a mensagem
registrada em `detalhes[].erro`, em vez de derrubar a execução inteira.

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
