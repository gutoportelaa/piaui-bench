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
import math
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
LETRAS = ("A", "B", "C", "D", "E")
BASELINE = 1 / len(LETRAS)


def indice(dados: dict) -> dict:
    return {r["modelo"]: r for r in dados["resultados"]}


def ic_agrupado(resultado: dict, z: float = 1.959964) -> tuple:
    """Erro-padrao e IC 95% com agrupamento no nivel da QUESTAO.

    As repeticoes de uma mesma questao nao sao observacoes independentes: sao a
    mesma pergunta reapresentada. Tratar as 50 chamadas como n=50 subestimaria
    o erro em ~2,2x. A unidade amostral e a questao, entao calculamos a taxa de
    acerto por questao e tiramos o erro-padrao dessas taxas.

    Ver Miller (2024), "Adding Error Bars to Evals", secao sobre clustered
    standard errors para questoes com multiplas amostras.
    """
    taxas = [d["acertos"] / len(d["respostas"]) for d in resultado["detalhes"] if d["respostas"]]
    n = len(taxas)
    if n < 2:
        return 0.0, (0.0, 1.0), n
    media = sum(taxas) / n
    var = sum((t - media) ** 2 for t in taxas) / (n - 1)
    erro = math.sqrt(var / n)
    return erro, (max(0.0, media - z * erro), min(1.0, media + z * erro)), n


def consolida(fixa: dict, permutada: dict) -> dict:
    a, b = indice(fixa), indice(permutada)
    linhas = []

    for modelo in a:
        rf = a[modelo]
        rp = b.get(modelo)
        if rp is None:
            continue

        erro, (ic_lo, ic_hi), n_questoes = ic_agrupado(rp)
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
            # Erro-padrao agrupado por questao (n = numero de questoes, nao de chamadas).
            "erro_padrao": round(erro, 4),
            "ic95": [round(ic_lo, 4), round(ic_hi, 4)],
            "n_questoes": n_questoes,
            # Se o IC cobre 20%, o resultado nao se distingue do acaso.
            "distinguivel_do_acaso": ic_lo > BASELINE,
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
    cab = ("| Modelo | Acurácia (fixa) | Acurácia (permutada) | IC 95% | Variação | "
           "Letra dominante |\n|---|---|---|---|---|---|")
    linhas = [
        f"| `{l['modelo']}` | {l['acuracia_fixa']:.1%} | {l['acuracia_permutada']:.1%} | "
        f"[{l['ic95'][0]:.1%}, {l['ic95'][1]:.1%}] | {l['variacao_pp']:+.1f} p.p. | "
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
