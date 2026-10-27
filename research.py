"""Reproduce the first lottery study from saved official data; stdlib only."""
from collections import Counter
from datetime import date
from fractions import Fraction
from math import comb, sqrt
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
AS_OF = date(2026, 10, 27)
GAMES = {
    "dlt": {"name": "大乐透", "main": (35, 5), "extra": (12, 2),
            "zones": ("前区", "后区"),
            "rules": "https://m.lottery.gov.cn/ksjz/m/yxgz_dlt/",
            "history": "https://www.gstc.org.cn/wanfa/dlt_history"},
    "ssq": {"name": "双色球", "main": (33, 6), "extra": (16, 1),
            "zones": ("红球", "蓝球"),
            "rules": "https://www.scflcp.com.cn/yxgz/823145252.jhtml",
            "history": "https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/"},
}


def prize(game, a, b, special=False):
    if game == "dlt":
        groups = [[(5, 2)], [(5, 1)], [(5, 0), (4, 2)], [(4, 1)],
                  [(4, 0), (3, 2)], [(3, 1), (2, 2)],
                  [(3, 0), (2, 1), (1, 2), (0, 2)]]
        for rank, matches in enumerate(groups, 1):
            if (a, b) in matches:
                return str(rank)
    else:
        if a == 6:
            return "1" if b else "2"
        if a == 5:
            return "3" if b else "4"
        if a == 4:
            return "4" if b else "5"
        if a == 3 and b:
            return "5"
        if b:
            return "6"
        if special and a == 3:
            return "福运奖"
    return "未中奖"


def outcome_counts(game, special=False):
    cfg = GAMES[game]
    n, k = cfg["main"]
    m, j = cfg["extra"]
    counts = Counter()
    for a in range(k + 1):
        for b in range(j + 1):
            ways = comb(k, a) * comb(n - k, k - a) * comb(j, b) * comb(m - j, j - b)
            counts[prize(game, a, b, special)] += ways
    total = comb(n, k) * comb(m, j)
    assert sum(counts.values()) == total
    assert counts["1"] == 1
    return total, counts


def load_draws(game):
    raw = json.loads((ROOT / "data" / f"{game}-raw.json").read_text())
    if game == "dlt":
        draws = [{"issue": r["issue_num"], "date": r["prize_time"],
                  "main": list(map(int, r["prize_num"][:5])),
                  "extra": list(map(int, r["prize_num"][5:]))}
                 for r in raw["response"]["data"]["prize_history_list"]]
    else:
        draws = [{"issue": r["code"], "date": r["date"][:10],
                  "main": list(map(int, r["red"].split(","))),
                  "extra": list(map(int, r["blue"].split(",")))}
                 for r in raw["response"]["result"]]
    assert len(draws) == 100
    assert len({r["issue"] for r in draws}) == len(draws)
    assert len({r["date"] for r in draws}) == len(draws)
    for r in draws:
        assert date.fromisoformat(r["date"]) <= AS_OF
        for zone in ("main", "extra"):
            n, k = GAMES[game][zone]
            assert len(r[zone]) == len(set(r[zone])) == k
            assert all(1 <= x <= n for x in r[zone])
    draws.sort(key=lambda r: r["date"], reverse=True)
    # These snapshots both lie within 2026, so sequence gaps can be checked directly.
    assert all(int(a["issue"]) - int(b["issue"]) == 1 for a, b in zip(draws, draws[1:]))
    return draws


def zone_stats(draws, zone, n, k):
    counts = Counter(x for row in draws for x in row[zone])
    assert sum(counts.values()) == len(draws) * k
    counts = {i: counts[i] for i in range(1, n + 1)}
    lo, hi = min(counts.values()), max(counts.values())
    return {"expected_count": len(draws) * k / n,
            "single_number_sd": sqrt(len(draws) * k / n * (1 - k / n)),
            "counts": counts,
            "min_count": lo, "max_count": hi,
            "least_frequent": [i for i, v in counts.items() if v == lo],
            "most_frequent": [i for i, v in counts.items() if v == hi]}


def run():
    result = {"as_of": str(AS_OF), "assumption": "各期独立、每个合法组合等可能", "games": {}}
    lines = ["# 大乐透与双色球：第一轮研究", "", "核对与采集日期：2026-10-27（北京时间）。", "",
             "## 先看结论", "",
             "历史频率是样本描述；公平独立开奖时，每个合法完整组合的下一期概率相同。",
             "相同号码的重复投注不增加覆盖的开奖结果数。复式会增加不同组合数，同时增加成本。",
             "本轮未进行选号预测、收益回测或随机性显著性检验。", "",
             "## 规则版本", "",
             "大乐透采用 2026 年现行七奖级规则。双色球分别计算常规奖级和执行特别规定（含福运奖）两种情形。",
             "双色球特别规定的启停具有延续性：奖池达到 15 亿元开启，开启后低于 3 亿元才停止，不能仅凭当期奖池是否低于 15 亿元判断。",
             "本轮不推断下一期特别规定状态；实际奖级与奖金以对应期开奖公告为准。", "",
             "## 精确概率", "",
             "均为单注 2 元基本投注，任意奖表示获得至少一个奖级，不表示多注投注后整体盈利。", "",
             "| 彩种 / 情形 | 合法完整组合数 | 单注一等奖概率 | 单注任意奖概率 |",
             "|---|---:|---:|---:|"]
    for game, cfg in GAMES.items():
        draws = load_draws(game)
        total, counts = outcome_counts(game)
        assert total == {"dlt": 21425712, "ssq": 17721088}[game]
        win = Fraction(total - counts["未中奖"], total)
        stats = {zone: zone_stats(draws, zone, *cfg[zone]) for zone in ("main", "extra")}
        entry = {**cfg, "total_combinations": total, "prize_outcome_counts": dict(counts),
                 "any_prize_probability": float(win), "draws": draws, "statistics": stats}
        result["games"][game] = entry
        lines.append(f"| {cfg['name']}（{'七奖级' if game == 'dlt' else '未执行特别规定'}） | {total:,} | 1 / {total:,} | {float(win):.6%} |")
        if game == "ssq":
            _, special = outcome_counts(game, True)
            special_win = Fraction(total - special["未中奖"], total)
            entry["special_prize_outcome_counts"] = dict(special)
            entry["special_any_prize_probability"] = float(special_win)
            lines.append(f"| 双色球（执行特别规定） | {total:,} | 1 / {total:,} | {float(special_win):.6%} |")
    lines += ["", "一等奖计算：大乐透 C(35,5) × C(12,2)；双色球 C(33,6) × C(16,1)。",
              "任意奖概率使用超几何分布，对各命中情况的组合数精确求和，每种情况只归入最高奖级。",
              "前区/红球恰中 a 个的组合数为 C(k,a) × C(n−k,k−a)，后区/蓝球同理，两区相乘。", "",
              "同一期购买 m 个不同完整组合，一等奖概率为 m/N；同一组合买 m 倍仍为 1/N。",
              "若连续 T 期每期购买 m 个不同组合，则至少一次一等奖概率为 1−(1−m/N)^T。",
              "此式依赖各期独立；同一期不同组合的一等奖事件互斥，不能套用独立事件公式。",
              "大乐透追加投注增加金额和对应奖金权益，不增加所选完整组合的命中概率。",
              "此处不估算总回报率：浮动奖、奖池、中奖注数、特别规定和派奖都会影响实际奖金。", "",
              "## 官方最近 100 期样本", "",
              "统计窗口各为 100 期，日期范围可能不同；采集日尚未公布的开奖不在样本内。", "",
              "| 彩种 | 期号范围 | 日期范围 | 样本数 |", "|---|---|---|---:|"]
    for game, entry in result["games"].items():
        rows = entry["draws"]
        lines.append(f"| {entry['name']} | {rows[-1]['issue']}–{rows[0]['issue']} | {rows[-1]['date']}–{rows[0]['date']} | {len(rows)} |")
    lines += ["", "| 号码区域 | 每个号码的理论平均出现次数 | 实际最少次数 | 实际最多次数 |", "|---|---:|---:|---:|"]
    for entry in result["games"].values():
        for key, label in zip(("main", "extra"), entry["zones"]):
            stat = entry["statistics"][key]
            lines.append(f"| {entry['name']}{label} | {stat['expected_count']:.2f} | {stat['min_count']} | {stat['max_count']} |")
    lines += ["", "理论平均不是各号码必须达到的次数；最少/最多次数是观察多个号码后挑出的极值。",
              "本表不检验异常，也不能据此判断某个号码下一期更容易出现；所有号码逐项频数保存在 analysis.json。", "",
              "## 下一步研究设计", "",
              "若进一步检验冷热号、遗漏或和值筛选，先固定策略和窗口，按时间划分训练与测试数据，每期只使用此前开奖。",
              "与相同成本、相同不同组合数量的随机选号比较，报告不确定性并校正多重比较；奖金回测需逐期匹配历史规则与实际奖金。", "",
              "## 来源与复现", ""]
    for cfg in GAMES.values():
        lines.append(f"- {cfg['name']}：[规则]({cfg['rules']})；[历史开奖]({cfg['history']})。")
    lines += ["", "原始 JSON、接口地址、请求参数及采集日期保存在 data/*-raw.json；本报告基于本地快照，不自动更新。",
              "在项目目录执行 `python3 research.py`，即可重新计算 analysis.json 和 RESEARCH.md，无第三方依赖。",
              "计算时检查每期号码数量、范围、区内重复、期号/日期唯一性、期号连续性、未来日期、频数总和，以及全部命中事件的组合数之和。", ""]
    (ROOT / "analysis.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    (ROOT / "RESEARCH.md").write_text("\n".join(lines))
    for entry in result["games"].values():
        print(entry["name"], entry["total_combinations"], entry["any_prize_probability"])
        print(entry["statistics"])
        if "special_any_prize_probability" in entry:
            print("special", entry["special_any_prize_probability"])


if __name__ == "__main__":
    run()
