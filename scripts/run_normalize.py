# -*- coding: utf-8 -*-
"""Пакетный прогон мокапов и машинная приёмка.

Глазами 45 файлов не проверить, поэтому приёмка машинная: скрипт сам открывает
каждый результат заново и проверяет инварианты. Печатает таблицу
«файл -> исходный bbox -> масштаб -> итоговый bbox» и падает с кодом 1,
если хоть один инвариант нарушен.

    python scripts/run_normalize.py --skip-lines Champion,New
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

from normalize_mockups import CANVAS, ink_bbox, normalize, plan, save_mockup  # noqa: E402

# Допуск на совпадение рамки: округление при масштабировании даёт ±1 пиксель,
# два берём с запасом. Больше двух — это уже разъехавшиеся зоны.
TOLERANCE = 2

# Потолок веса одного мокапа. Взят от реальной партии, а не выдуман: после
# перехода на WebP (28.08) все 45 файлов укладываются в 25..130 КБ, суммарно
# 3.3 МБ против 29 МБ в PNG. Округлено вверх примерно в полтора раза, чтобы
# порог ловил выброс, а не ругался на нормальный файл.
# ⚠️ Прежние 600 КБ достались от PNG-набора и после WebP не сработали бы
# никогда — порог обязан ехать за форматом, иначе сторож перестаёт сторожить.
WEIGHT_BUDGET = 200 * 1024


def run(map_path, out_dir, skip_lines, report_path):
    mapping = json.loads(Path(map_path).read_text(encoding="utf-8"))
    tasks = [t for t in plan(mapping) if t["line"] not in skip_lines]
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    rows, broken = [], []
    for t in tasks:
        try:
            with Image.open(t["src"]) as im:
                src_box = ink_bbox(np.asarray(im.convert("RGB"), "uint8"))
                result = normalize(im)
        except Exception as e:  # noqa: BLE001 — битый файл не должен ронять партию
            broken.append((t["target"], repr(e)))
            continue

        dst = save_mockup(result, out_dir / t["target"])

        with Image.open(dst) as saved:
            size = saved.size
            got = ink_bbox(np.asarray(saved.convert("RGB"), "uint8"))

        src_h = src_box[3] - src_box[1] + 1
        rows.append(
            {
                "line": t["line"],
                "target": t["target"],
                "src_box": src_box,
                "scale": round((got[3] - got[1] + 1) / src_h, 3),
                "out_box": got,
                "size": size,
                "bytes": dst.stat().st_size,
            }
        )

    return rows, broken, report(rows, broken, report_path)


def report(rows, broken, report_path):
    """Проверка инвариантов. Возвращает список нарушений (пустой = приёмка пройдена)."""
    bad = []
    if broken:
        bad += [f"битый файл {n}: {e}" for n, e in broken]

    for r in rows:
        if r["size"] != CANVAS:
            bad.append(f"{r['target']}: размер {r['size']}, ожидался {CANVAS}")
        if r["bytes"] > WEIGHT_BUDGET:
            bad.append(f"{r['target']}: вес {r['bytes'] // 1024} КБ выше бюджета")

    if rows:
        tops = [r["out_box"][1] for r in rows]
        heights = [r["out_box"][3] - r["out_box"][1] + 1 for r in rows]
        # Ширину не сверяем: пропорция формы законно гуляет 0.48..0.62.
        # Сверяем центр — зоны заданы долями ширины ХОЛСТА, а не формы.
        centers = [(r["out_box"][0] + r["out_box"][2]) / 2 for r in rows]
        if max(tops) - min(tops) > TOLERANCE:
            bad.append(f"верх рамки разъехался: {min(tops)}..{max(tops)}")
        if max(heights) - min(heights) > TOLERANCE:
            bad.append(f"высота рамки разъехалась: {min(heights)}..{max(heights)}")
        if max(centers) - min(centers) > TOLERANCE:
            bad.append(f"центр рамки разъехался: {min(centers)}..{max(centers)}")

    lines = [
        "# Приёмка нормализации мокапов",
        "",
        f"Файлов в партии: **{len(rows)}**, битых: **{len(broken)}**.",
        "",
        "| Линейка | Расцветка | Исходный bbox | Масштаб | Итоговый bbox | Размер | КБ |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        lines.append(
            f"| {r['line']} | {r['target']} | {r['src_box']} | {r['scale']}x | "
            f"{r['out_box']} | {r['size'][0]}x{r['size'][1]} | {r['bytes'] // 1024} |"
        )
    lines += ["", "## Инварианты", ""]
    lines += [f"- 🔴 {b}" for b in bad] or ["- 🟢 нарушений нет"]
    Path(report_path).write_text("\n".join(lines) + "\n", encoding="utf-8")
    return bad


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--map", default="scripts/mockup-map.json")
    p.add_argument("--out", default="assets/mockups")
    p.add_argument("--skip-lines", default="")
    p.add_argument("--report", default="docs/приёмка-нормализации.md")
    a = p.parse_args()

    skip = {s for s in a.skip_lines.split(",") if s}
    rows, broken, bad = run(a.map, a.out, skip, a.report)
    print(f"прогнано {len(rows)}, битых {len(broken)}, нарушений {len(bad)}")
    for b in bad:
        print("  !", b)
    sys.exit(1 if bad else 0)
