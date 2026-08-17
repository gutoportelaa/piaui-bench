#!/usr/bin/env python3
"""
PiauiBench — executa o benchmark de 10 questoes de multipla escolha sobre o
Piaui contra modelos locais servidos pelo Ollama e grava docs/results.json.

Uso:
    python3 bench/run_bench.py
    python3 bench/run_bench.py --models llama3.2:3b qwen3:4b gemma3:4b --runs 3

Sem dependencias externas: usa apenas a biblioteca padrao.
"""

import argparse
import json
import random
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
BENCHMARK = RAIZ / "docs" / "benchmark.json"
RESULTADOS = RAIZ / "docs" / "results.json"

SYSTEM_PROMPT = (
    "Voce e um especialista em geografia, historia e cultura do Estado do Piaui, Brasil. "
    "Responda as questoes de multipla escolha escolhendo exatamente uma alternativa. "
    "Responda somente com a letra da alternativa correta (A, B, C, D ou E), sem explicacao."
)

# Esquema de saida estruturada do Ollama: forca o modelo a devolver uma letra valida.
FORMATO = {
    "type": "object",
    "properties": {"resposta": {"type": "string", "enum": ["A", "B", "C", "D", "E"]}},
    "required": ["resposta"],
}

LETRAS = ("A", "B", "C", "D", "E")


def embaralha(questao: dict, seed: int) -> dict:
    """Permuta as alternativas com semente fixa e remapeia o gabarito.

    Serve para medir vies posicional: um modelo que realmente sabe a resposta
    mantem a acuracia sob permutacao; um que so prefere a letra "A" despenca.
    """
    valores = [questao["alternativas"][l] for l in LETRAS]
    correta = questao["alternativas"][questao["resposta"]]
    random.Random(f"{questao['id']}-{seed}").shuffle(valores)
    novo = dict(questao)
    novo["alternativas"] = dict(zip(LETRAS, valores))
    novo["resposta"] = LETRAS[valores.index(correta)]
    return novo


def monta_prompt(questao: dict) -> str:
    linhas = [questao["pergunta"], ""]
    for letra in LETRAS:
        linhas.append(f"{letra}) {questao['alternativas'][letra]}")
    linhas.append("")
    linhas.append("Responda apenas com a letra da alternativa correta.")
    return "\n".join(linhas)


def extrai_letra(texto: str) -> str | None:
    """Extrai a letra da resposta, aceitando JSON estruturado ou texto livre."""
    texto = (texto or "").strip()
    if not texto:
        return None

    try:
        dados = json.loads(texto)
        if isinstance(dados, dict):
            valor = str(dados.get("resposta", "")).strip().upper()
            if valor[:1] in LETRAS:
                return valor[:1]
    except (json.JSONDecodeError, TypeError):
        pass

    # Remove blocos de raciocinio (<think>...</think>) antes de procurar a letra.
    limpo = re.sub(r"<think>.*?</think>", " ", texto, flags=re.DOTALL | re.IGNORECASE)
    achado = re.search(r"\b([A-E])\b", limpo.upper())
    return achado.group(1) if achado else None


def chama_ollama(host: str, modelo: str, prompt: str, seed: int, timeout: int) -> tuple[str, float]:
    corpo = {
        "model": modelo,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "stream": False,
        "format": FORMATO,
        "think": False,  # desliga o modo de raciocinio (Qwen3 e similares)
        "options": {"temperature": 0, "top_p": 1, "seed": seed, "num_predict": 64},
    }
    req = urllib.request.Request(
        f"{host}/api/chat",
        data=json.dumps(corpo).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    inicio = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            dados = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as erro:
        # Modelos sem suporte a "think" recusam o campo; tenta de novo sem ele.
        if erro.code == 400:
            corpo.pop("think", None)
            req = urllib.request.Request(
                f"{host}/api/chat",
                data=json.dumps(corpo).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                dados = json.loads(resp.read().decode("utf-8"))
        else:
            raise
    decorrido = time.perf_counter() - inicio
    return dados.get("message", {}).get("content", ""), decorrido


def avalia_modelo(host: str, modelo: str, questoes: list, runs: int, timeout: int,
                  shuffle: bool = False) -> dict:
    respostas = []
    acertos_por_run = [0] * runs
    letras_vistas = []  # letras como apresentadas ao modelo, para medir vies posicional
    tempo_total = 0.0

    for questao in questoes:
        letras, tempos, erro_msg = [], [], None
        for r in range(runs):
            # Com --shuffle cada repeticao usa uma permutacao diferente das alternativas.
            qv = embaralha(questao, r) if shuffle else questao
            try:
                bruto, decorrido = chama_ollama(host, modelo, monta_prompt(qv), seed=42 + r, timeout=timeout)
            except Exception as exc:  # rede, timeout, modelo ausente
                erro_msg = f"{type(exc).__name__}: {exc}"
                letras.append(None)
                tempos.append(0.0)
                continue
            letra_vista = extrai_letra(bruto)
            letras_vistas.append(letra_vista)
            # Normaliza de volta para o espaco de letras original, para que as
            # respostas sejam comparaveis entre repeticoes e entre modelos.
            texto = qv["alternativas"].get(letra_vista) if letra_vista else None
            letra = next((l for l in LETRAS if questao["alternativas"][l] == texto), None)
            letras.append(letra)
            tempos.append(decorrido)
            tempo_total += decorrido
            if letra == questao["resposta"]:
                acertos_por_run[r] += 1

        acertos = sum(1 for letra in letras if letra == questao["resposta"])
        respostas.append(
            {
                "questao": questao["id"],
                "gabarito": questao["resposta"],
                "respostas": letras,
                "resposta_moda": max(set(letras), key=letras.count) if letras else None,
                "acertos": acertos,
                "correta": acertos > runs / 2,
                "latencia_media_s": round(sum(tempos) / len(tempos), 3) if tempos else 0.0,
                "erro": erro_msg,
            }
        )
        status = "OK " if acertos == runs else ("~  " if acertos else "ERR")
        print(f"  [{status}] {questao['id']}  gabarito={questao['resposta']}  modelo={letras}")

    total = len(questoes) * runs
    acertos_totais = sum(item["acertos"] for item in respostas)
    return {
        "modelo": modelo,
        "runs": runs,
        "shuffle": shuffle,
        "distribuicao_letras": {l: letras_vistas.count(l) for l in LETRAS},
        "acuracia": round(acertos_totais / total, 4) if total else 0.0,
        "acuracia_por_run": [round(a / len(questoes), 4) for a in acertos_por_run],
        "acertos": acertos_totais,
        "total": total,
        "latencia_media_s": round(tempo_total / total, 3) if total else 0.0,
        "detalhes": respostas,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Executa o PiauiBench no Ollama.")
    parser.add_argument("--models", nargs="+", default=["llama3.2:3b", "qwen3:4b", "gemma3:4b"])
    parser.add_argument("--runs", type=int, default=3, help="repeticoes por questao (default: 3)")
    parser.add_argument("--host", default="http://localhost:11434")
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--shuffle", action="store_true",
                        help="permuta as alternativas a cada repeticao (mede vies posicional)")
    parser.add_argument("--out", default=str(RESULTADOS))
    args = parser.parse_args()

    benchmark = json.loads(BENCHMARK.read_text(encoding="utf-8"))
    questoes = benchmark["questoes"]

    resultados = []
    for modelo in args.models:
        print(f"\n>> {modelo}  ({len(questoes)} questoes x {args.runs} runs)")
        resultado = avalia_modelo(args.host, modelo, questoes, args.runs, args.timeout, args.shuffle)
        print(f"   acuracia = {resultado['acuracia']:.1%}  latencia media = {resultado['latencia_media_s']}s")
        resultados.append(resultado)

    saida = {
        "benchmark_id": benchmark["id"],
        "benchmark_versao": benchmark["version"],
        "executado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "host": args.host,
        "runs": args.runs,
        "shuffle": args.shuffle,
        "metrica": "acuracia",
        "resultados": sorted(resultados, key=lambda r: r["acuracia"], reverse=True),
    }
    Path(args.out).write_text(json.dumps(saida, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nResultados gravados em {args.out}")


if __name__ == "__main__":
    main()
