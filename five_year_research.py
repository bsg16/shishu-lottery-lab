"""Five-year descriptive checks and chronological backtest; requires NumPy."""
from collections import Counter
from datetime import date
from functools import lru_cache
from hashlib import sha256
from math import comb
from pathlib import Path
import json
import numpy as np

from research import GAMES, outcome_counts, prize

ROOT = Path(__file__).resolve().parent
START, END, TEST_START = "2021-10-27", "2026-10-27", "2024-10-27"
SIMULATIONS = 10_000
SEED = 20261027
STRATEGIES = {"hot": "近50期热号", "cold": "近50期冷号", "overdue": "最大遗漏"}


def read_draws(game):
    files = [ROOT / "data" / f"{game}-five-year-raw.json"]
    if game == "dlt":
        files += [ROOT / "data" / f"dlt-five-year-page-{p}.json" for p in range(2, 9)]
    all_rows = []
    for path in files:
        response = json.loads(path.read_text())["response"]
        if game == "dlt":
            all_rows += [{"issue": r["issue_num"], "date": r["prize_time"],
                          "main": list(map(int, r["prize_num"][:5])),
                          "extra": list(map(int, r["prize_num"][5:]))}
                         for r in response["data"]["prize_history_list"]]
        else:
            all_rows += [{"issue": r["code"], "date": r["date"][:10],
                          "main": list(map(int, r["red"].split(","))),
                          "extra": list(map(int, r["blue"].split(",")))}
                         for r in response["result"]]
    corrections = json.loads((ROOT / "data" / "five-year-corrections.json").read_text())
    for correction in corrections:
        if correction["game"] == game:
            matching = [r for r in all_rows if r["issue"] == correction["issue"]]
            assert len(matching) == 1
            row = matching[0]
            assert row[correction["field"]] == correction["original"]
            row[correction["field"]] = correction["corrected"]
    all_rows.sort(key=lambda r: r["date"])
    assert all_rows[0]["date"] < START, "Need an earlier draw to confirm start coverage"
    rows = [r for r in all_rows if START <= r["date"] <= END]
    assert len({r["issue"] for r in rows}) == len(rows)
    assert len({r["date"] for r in rows}) == len(rows)
    for r in rows:
        date.fromisoformat(r["date"])
        for zone in ("main", "extra"):
            n, k = GAMES[game][zone]
            assert len(r[zone]) == len(set(r[zone])) == k
            assert r[zone] == sorted(r[zone])
            assert all(1 <= number <= n for number in r[zone])
    for before, after in zip(rows, rows[1:]):
        if before["date"][:4] == after["date"][:4]:
            assert int(after["issue"]) == int(before["issue"]) + 1
        else:
            assert int(after["issue"][-3:]) == 1
            assert int(after["date"][:4]) == int(before["date"][:4]) + 1
    # Verify overlap with the independently saved first-round snapshot.
    previous = json.loads((ROOT / "analysis.json").read_text())["games"][game]["draws"]
    lookup = {r["issue"]: r for r in rows}
    assert all(lookup[r["issue"]] == r for r in previous)
    return rows


def overlap_pmf(n, k):
    pmf = np.array([comb(k, a) * comb(n - k, k - a) / comb(n, k) for a in range(k + 1)])
    assert abs(pmf.sum() - 1) < 1e-12
    return pmf


def sum_pmf(pmf, count):
    result = np.array([1.0])
    for _ in range(count):
        result = np.convolve(result, pmf)
    assert abs(result.sum() - 1) < 1e-10
    return result / result.sum()


def two_sided(pmf, observed):
    return float(min(1, 2 * min(pmf[:observed + 1].sum(), pmf[observed:].sum())))


def frequency_test(draws, zone, n, k, rng):
    numbers = np.array([r[zone] for r in draws]) - 1
    counts = np.bincount(numbers.ravel(), minlength=n)
    expected = len(draws) * k / n
    score = float(np.square(counts - expected).sum() / expected)
    extreme = 0
    # Every simulated draw samples k distinct numbers; this preserves negative
    # dependence between number indicators within a draw.
    for batch_start in range(0, SIMULATIONS, 64):
        batch = min(64, SIMULATIONS - batch_start)
        keys = rng.random((batch, len(draws), n))
        picks = np.argpartition(keys, k - 1, axis=2)[:, :, :k]
        offsets = np.arange(batch)[:, None, None] * n
        trial_counts = np.bincount((picks + offsets).ravel(), minlength=batch * n).reshape(batch, n)
        scores = np.square(trial_counts - expected).sum(axis=1) / expected
        extreme += int(np.count_nonzero(scores >= score - 1e-12))
    return {"counts": counts.tolist(), "expected": expected, "statistic": score,
            "p_raw": (extreme + 1) / (SIMULATIONS + 1),
            "min_count": int(counts.min()), "max_count": int(counts.max())}


def structural_stats(rows, n, k):
    odds = Counter(sum(x % 2 for x in r["main"]) for r in rows)
    expected_odds = {a: comb((n + 1) // 2, a) * comb(n // 2, k - a) / comb(n, k) for a in range(k + 1)}
    balanced = [k // 2] if k % 2 == 0 else [k // 2, k // 2 + 1]
    adjacent = sum(any(b - a == 1 for a, b in zip(r["main"], r["main"][1:])) for r in rows)
    return {"odd_count_observed": dict(odds), "odd_count_expected_probabilities": expected_odds,
            "balanced_odd_counts": balanced,
            "balanced_observed_rate": sum(odds[a] for a in balanced) / len(rows),
            "balanced_expected_rate": sum(expected_odds[a] for a in balanced),
            "adjacent_observed_rate": adjacent / len(rows),
            "adjacent_expected_rate": 1 - comb(n - k + 1, k) / comb(n, k),
            "sum_observed_mean": sum(sum(r["main"]) for r in rows) / len(rows),
            "sum_expected_mean": k * (n + 1) / 2}


@lru_cache(maxsize=None)
def tie_key(game, zone, strategy, number):
    return sha256(f"lottery-study-v1:{game}:{zone}:{strategy}:{number}".encode()).digest()


def select_numbers(history, game, zone, strategy):
    n, k = GAMES[game][zone]
    if strategy == "overdue":
        last_seen = {i: -1 for i in range(1, n + 1)}
        for index, row in enumerate(history):
            for number in row[zone]:
                last_seen[number] = index
        # Small last-seen index means a long omission. Never-seen numbers tie.
        scores = last_seen
    else:
        counts = Counter(x for row in history[-50:] for x in row[zone])
        scores = {i: counts[i] * (-1 if strategy == "hot" else 1) for i in range(1, n + 1)}
    ordered = sorted(range(1, n + 1), key=lambda i: (scores[i], tie_key(game, zone, strategy, i)))
    return sorted(ordered[:k])


def backtest(rows, game):
    cfg = GAMES[game]
    eligible = [i for i, row in enumerate(rows) if row["date"] >= TEST_START]
    assert eligible[0] >= 50
    pmf = np.convolve(overlap_pmf(*cfg["main"]), overlap_pmf(*cfg["extra"]))
    null_sum = sum_pmf(pmf, len(eligible))
    mean = float(np.dot(np.arange(len(pmf)), pmf))
    results = {}
    for strategy, label in STRATEGIES.items():
        predictions = []
        hits, any_wins = 0, 0
        for i in eligible:
            row = rows[i]
            history = rows[:i]
            ticket = {zone: select_numbers(history, game, zone, strategy) for zone in ("main", "extra")}
            matched = {zone: len(set(ticket[zone]) & set(row[zone])) for zone in ("main", "extra")}
            hits += sum(matched.values())
            any_wins += prize(game, matched["main"], matched["extra"], special=False) != "未中奖"
            predictions.append({"issue": row["issue"], "date": row["date"], "history_end": history[-1]["date"],
                                "ticket": ticket, "hits": matched})
        results[strategy] = {"name": label, "draw_count": len(eligible), "total_hits": hits,
                             "mean_hits": hits / len(eligible), "null_mean_hits": mean,
                             "p_raw": float(null_sum[hits:].sum()), "ordinary_wins": any_wins,
                             "first_date": rows[eligible[0]]["date"], "last_date": rows[eligible[-1]]["date"],
                             "predictions": predictions}
    return results


def holm(tests):
    running = 0.0
    for rank, test in enumerate(sorted(tests, key=lambda t: t["p_raw"])):
        running = max(running, min(1.0, test["p_raw"] * (len(tests) - rank)))
        test["p_holm"] = running
        test["significant_005"] = running < 0.05


def render_report(output):
    games = output["games"]
    lines = ["# 近五年大乐透与双色球：有分布规律，是否有预测优势？", "",
             f"数据区间：{START} 至 {END}；仅包含采集时已公布的开奖。", "",
             "## 范围", "",
             "不考虑福运奖、派奖、追加奖金或其他特别奖。研究开奖号码本身，不计算投注回报率。",
             "下文常规中奖次数使用 2026 年常规中奖条件统一重算，仅为描述性对比，不代表当年实际兑奖。",
             "此前已看过最近 100 期；本次是按时间回放的历史检验，不是完全未见数据的盲测。", "",
             "## 数据覆盖", "", "| 彩种 | 期数 | 开奖日期范围 | 期号范围 |", "|---|---:|---|---|"]
    for game, data in games.items():
        rows = data["draws"]
        lines.append(f"| {GAMES[game]['name']} | {len(rows)} | {rows[0]['date']}–{rows[-1]['date']} | {rows[0]['issue']}–{rows[-1]['issue']} |")
    lines += ["", "已检查号码范围/数量/区内唯一性、日期/期号唯一性、年内连续期号、跨年首期以及与先前 100 期快照的一致性。",
              "官方返回可能多于请求的日期范围，分析前已按日期严格过滤。",
              "数据清洗发现大乐透 25092 期日期错位：甘肃接口为 2025-09-04，依据[广东体彩该期开奖公告](https://www.gdlottery.cn/f_html/kjgg/P085_25092.html)更正为 2025-08-13；开奖号码一致。原始响应保留，修正在 data/five-year-corrections.json 记录。", "",
              "## 哪些规律本来就应该出现", "",
              "奇偶较均衡、至少一组连号等类别包含大量不同组合，类别常见不意味着其中某个具体组合更容易中奖。", "",
              "| 彩种与结构 | 五年实际比例 | 公平随机模型理论比例 |", "|---|---:|---:|"]
    for game, data in games.items():
        cfg, stat = GAMES[game], data["structure"]
        parity = "2奇3偶或3奇2偶" if game == "dlt" else "3奇3偶"
        lines += [f"| {cfg['name']}：{parity} | {stat['balanced_observed_rate']:.2%} | {stat['balanced_expected_rate']:.2%} |",
                  f"| {cfg['name']}：主区至少一组连号 | {stat['adjacent_observed_rate']:.2%} | {stat['adjacent_expected_rate']:.2%} |"]
    lines += ["", "“连号”指同一期主区存在相邻整数，包含更长连号串；统计排序后的号码。以上只是描述性比较。", "",
              "## 号码频率与相邻期重号", "",
              "频率检验比较每区全部号码的总体偏差，零假设模拟保留同期开奖内无放回抽样结构。",
              "重号检验比较相邻两期交集总数，使用超几何分布卷积的双侧尾部概率。", "",
              "| 区域 | 单号理论次数 | 最少–最多次数 | 频率检验原始 p | 校正 p |", "|---|---:|---:|---:|---:|"]
    for game, data in games.items():
        for zone, label in zip(("main", "extra"), GAMES[game]["zones"]):
            stat = data["zones"][zone]["frequency"]
            lines.append(f"| {GAMES[game]['name']}{label} | {stat['expected']:.2f} | {stat['min_count']}–{stat['max_count']} | {stat['p_raw']:.4f} | {stat['p_holm']:.4f} |")
    lines += ["", "| 区域 | 相邻期平均重号数 | 理论平均 | 原始 p | 校正 p |", "|---|---:|---:|---:|---:|"]
    for game, data in games.items():
        for zone, label in zip(("main", "extra"), GAMES[game]["zones"]):
            stat = data["zones"][zone]["lag_overlap"]
            lines.append(f"| {GAMES[game]['name']}{label} | {stat['mean']:.4f} | {stat['expected_mean']:.4f} | {stat['p_raw']:.4f} | {stat['p_holm']:.4f} |")
    lines += ["", "## 逐期回测：热号、冷号、遗漏号", "",
              f"评估从 {TEST_START} 开始，每个策略每期仅生成一注。前 50 期计算冷热；遗漏从观察区间起按此前开奖累计。",
              "不使用待测期或未来数据，并列号码由固定 SHA-256 排序决定。随机基准是均匀随机一注的精确分布，不是一条碰巧好或坏的随机样本。",
              "主指标是两区命中号码数之和，每期最多 7 个。检验方向为是否优于随机。命中数不是一等奖概率或盈利率。", "",
              "| 彩种 | 策略 | 测试期数 | 实际平均命中数 | 随机期望 | 原始 p | 校正 p |", "|---|---|---:|---:|---:|---:|---:|"]
    for game, data in games.items():
        for stat in data["backtests"].values():
            lines.append(f"| {GAMES[game]['name']} | {stat['name']} | {stat['draw_count']} | {stat['mean_hits']:.4f} | {stat['null_mean_hits']:.4f} | {stat['p_raw']:.4f} | {stat['p_holm']:.4f} |")
    lines += ["", "常规中奖次数仅作为辅助描述，未单独检验，不用它挑选优胜策略：", "",
              "| 彩种 | 策略 | 常规中奖期数 | 随机模型期望中奖期数 |", "|---|---|---:|---:|"]
    for game, data in games.items():
        total, counts = outcome_counts(game)
        win_probability = 1 - counts["未中奖"] / total
        for stat in data["backtests"].values():
            lines.append(f"| {GAMES[game]['name']} | {stat['name']} | {stat['ordinary_wins']} | {stat['draw_count'] * win_probability:.2f} |")
    lines += ["", "## 如何理解", "",
              "4 项频率检验、4 项重号检验、6 项策略检验，共 14 项一起进行 Holm 多重检验校正，阈值 0.05。",
              f"频率模拟次数 {SIMULATIONS:,}，固定随机种子 {SEED}；使用加一法估计尾部概率，模拟结果存在有限抽样误差。",
              "校正 p 小于 0.05 才按本方案标为显著。p 值不是“开奖公平的概率”或“策略有效的概率”。"]
    significant = [test["label"] for test in output["tests"] if test["significant_005"]]
    if significant:
        lines += ["", "本轮校正后达到阈值的项目：" + "、".join(significant) + "。这些结果需额外核查和独立未来数据验证，不能直接推成下一期号码或盈利优势。"]
    else:
        lines += ["", "本轮 14 项检验校正后均未达到 0.05 阈值；未发现这三种固定规则优于随机的统计证据。",
                  "这不证明任何形式的规律都不存在，也不是开奖公平性的完整审计；约 300 期回测无法排除很小的优势，更无法检验极罕见的一等奖收益。"]
    lines += ["", "## 可复现文件与来源", "",
              "方法先固定在 FIVE_YEAR_METHOD.md；完整频数、检验结果和逐期选号记录在 five-year-analysis.json；原始接口响应在 data/。",
              "执行 `python3 five_year_research.py` 重算（需要 NumPy）。不联网重抓数据。", ""]
    for game, cfg in GAMES.items():
        lines.append(f"- {cfg['name']}：[官方开奖数据]({cfg['history']})、[当前规则]({cfg['rules']})。")
    return "\n".join(lines) + "\n"


def run():
    output = {"start": START, "end": END, "test_start": TEST_START,
              "simulations": SIMULATIONS, "seed": SEED, "special_prizes": False, "games": {}, "tests": []}
    rng = np.random.default_rng(SEED)
    for game, cfg in GAMES.items():
        rows = read_draws(game)
        data = {"draws": rows, "structure": structural_stats(rows, *cfg["main"]), "zones": {}}
        output["games"][game] = data
        print(cfg["name"], len(rows), rows[0]["date"], rows[-1]["date"], flush=True)
        for zone, label in zip(("main", "extra"), cfg["zones"]):
            n, k = cfg[zone]
            freq = frequency_test(rows, zone, n, k, rng)
            freq["label"] = f"{cfg['name']}{label}频率"
            overlap = sum(len(set(a[zone]) & set(b[zone])) for a, b in zip(rows, rows[1:]))
            lag_null = sum_pmf(overlap_pmf(n, k), len(rows) - 1)
            lag = {"label": f"{cfg['name']}{label}相邻期重号", "total": overlap,
                   "mean": overlap / (len(rows) - 1), "expected_mean": k * k / n,
                   "p_raw": two_sided(lag_null, overlap)}
            data["zones"][zone] = {"frequency": freq, "lag_overlap": lag}
            output["tests"].extend([freq, lag])
            print(freq["label"], freq["p_raw"], lag["label"], lag["p_raw"], flush=True)
        data["backtests"] = backtest(rows, game)
        for stat in data["backtests"].values():
            stat["label"] = cfg["name"] + stat["name"] + "回测"
            output["tests"].append(stat)
    assert len(output["tests"]) == 14
    holm(output["tests"])
    for stat in output["tests"]:
        print(stat["label"], "p=", round(stat["p_raw"], 5), "Holm=", round(stat["p_holm"], 5), flush=True)
    # Avoid duplicating the per-period prediction records in the test summary.
    output["tests"] = [{k: stat[k] for k in ("label", "p_raw", "p_holm", "significant_005")} for stat in output["tests"]]
    (ROOT / "five-year-analysis.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    (ROOT / "FIVE_YEAR_RESEARCH.md").write_text(render_report(output))


if __name__ == "__main__":
    run()
