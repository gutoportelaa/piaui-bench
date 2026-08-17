#!/usr/bin/env python3
"""
Consolida as duas execucoes (ordem fixa e ordem permutada) num unico artefato.

Gera:
  docs/summary.json  -> lido pela aplicacao e por qualquer analise posterior
  tabela em Markdown -> stdout, para colar no relatorio
  docs/summary.csv   -> para abrir em planilha

Uso:
    python3 bench/consolidar.py
    python3 bench/consolidar.py --fixa docs/results.json --permutada docs/results_shuffle.json
"""

import argparse
import csv
import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
LETRAS = ("A", "B", "C", "D", "E")
BASELINE = 1 / len(LETRAS)


def indice(dados: dict) -> dict:
    return {r["modelo"]: r for r in dados["resultados"]}


def consolida(fixa: dict, permutada: dict) -> dict:
    a, b = indice(fixa), indice(permutada)
    linhas = []

    for modelo in a:
        rf = a[modelo]
        rp = b.get(modelo)
        if rp is None:
            continue

        total_letras = sum(rp["distribuicao_letras"].values()) or 1
        # Concentracao maxima numa unica letra sob permutacao: 20% = sem vies.
        letra_top, cont_top = max(rp["distribuicao_letras"].items(), key=lambda kv: kv[1])

        linhas.append({
            "modelo": modelo,
            "acuracia_fixa": rf["acuracia"],
            "acuracia_permutada": rp["acuracia"],
            # Variacao em PONTOS PERCENTUAIS: subtracao direta das duas acuracias.
            # Nao e variacao relativa (que seria delta / acuracia_fixa).
            "variacao_pp": round((rp["acuracia"] - rf["acuracia"]) * 100, 1),
            "variacao_relativa": round((rp["acuracia"] - rf["acuracia"]) / rf["acuracia"], 4)
            if rf["acuracia"] else None,
            # Quanto da acuracia permutada excede o acaso (20%), em pontos percentuais.
            "acima_do_acaso_pp": round((rp["acuracia"] - BASELINE) * 100, 1),
            "chamadas_fixa": rf["total"],
            "chamadas_permutada": rp["total"],
            "letra_mais_escolhida": letra_top,
            "concentracao_letra_top": round(cont_top / total_letras, 4),
            "latencia_media_s": rf["latencia_media_s"],
        })

    linhas.sort(key=lambda x: x["acuracia_permutada"], reverse=True)
    return {
        "benchmark_id": fixa["benchmark_id"],
        "benchmark_versao": fixa["benchmark_versao"],
        "gerado_de": {
            "fixa": {"executado_em": fixa["executado_em"], "runs": fixa["runs"], "modo": fixa.get("modo", "fixa")},
            "permutada": {"executado_em": permutada["executado_em"], "runs": permutada["runs"],
                          "modo": permutada.get("modo", "aleatoria")},
        },
        "baseline_aleatorio": BASELINE,
        "chamadas_totais": sum(l["chamadas_fixa"] + l["chamadas_permutada"] for l in linhas),
        "ranking": linhas,
    }


def markdown(resumo: dict) -> str:
    cab = ("| Modelo | Acurácia (fixa) | Acurácia (permutada) | Variação | Acima do acaso | "
           "Letra dominante |\n|---|---|---|---|---|---|")
    linhas = [
        f"| `{l['modelo']}` | {l['acuracia_fixa']:.1%} | {l['acuracia_permutada']:.1%} | "
        f"{l['variacao_pp']:+.1f} p.p. | {l['acima_do_acaso_pp']:+.1f} p.p. | "
        f"{l['letra_mais_escolhida']} ({l['concentracao_letra_top']:.0%}) |"
        for l in resumo["ranking"]
    ]
    return "\n".join([cab, *linhas])


def main() -> None:
    p = argparse.ArgumentParser(description="Consolida as execucoes do PiauiBench.")
    p.add_argument("--fixa", default=str(RAIZ / "docs" / "results.json"))
    p.add_argument("--permutada", default=str(RAIZ / "docs" / "results_shuffle.json"))
    p.add_argument("--out", default=str(RAIZ / "docs" / "summary.json"))
    p.add_argument("--csv", default=str(RAIZ / "docs" / "summary.csv"))
    args = p.parse_args()

    fixa = json.loads(Path(args.fixa).read_text(encoding="utf-8"))
    permutada = json.loads(Path(args.permutada).read_text(encoding="utf-8"))
    resumo = consolida(fixa, permutada)

    Path(args.out).write_text(json.dumps(resumo, ensure_ascii=False, indent=2), encoding="utf-8")
    with open(args.csv, "w", newline="", encoding="utf-8") as fh:
        escritor = csv.DictWriter(fh, fieldnames=list(resumo["ranking"][0].keys()))
        escritor.writeheader()
        escritor.writerows(resumo["ranking"])

    print(markdown(resumo))
    print(f"\nChamadas totais ao modelo: {resumo['chamadas_totais']}")
    print(f"Gravado: {args.out} e {args.csv}")


if __name__ == "__main__":
    main()
