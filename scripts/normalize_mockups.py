# -*- coding: utf-8 -*-
"""Нормализация мокапов формы к единому кадру конструктора.

Зачем: у клиента ощущение «одна линейка большая и хорошая, остальные мелкие».
Причина не в качестве файлов, а в пропорции — холст конструктора 0.75, а мокапы
приходят 19 разных размеров и 15 разных пропорций и ложатся с полями.

Контракт: форма в каждом кадре встаёт в ОДНУ И ТУ ЖЕ геометрическую рамку.
Зоны нанесения заданы долями 0..1 от холста, поэтому одинаковая рамка означает,
что зоны переносимы и расставлять их надо один раз на линейку, а не 45 раз.
"""
from pathlib import Path

import numpy as np
from PIL import Image

# Холст конструктора: src/config/mock-config.json -> canvas { width, height }.
CANVAS = (900, 1200)

# Доля высоты холста, которую занимает форма, и отступ сверху под плашку линейки.
# Остаток уходит вниз. Обе величины — контракт: они одинаковы для всех 45 файлов.
#
# Клиент 2026-08-29 (голосовое): «форма слишком высоко задрана, она задевает плашку
# и кнопку, должна быть чуть ниже» и «надо пространство сверху оставить для рабочих
# зон, мы туда будем что-то добавлять».
# Замер подтвердил: при TOP_MARGIN = 0.02 над формой было 24 px из 1200. Плашка линейки
# и кнопка «перейти в карточку» стоят в `.line-badge` абсолютом от `top: 0` (stand.css),
# высота плашки ~34 px при ширине холста 626 — то есть она физически перекрывала плечи.
# 0.10 даёт 120 px рабочей полосы: плашка и кнопка помещаются целиком и остаётся запас.
TOP_MARGIN = 0.10

# Потолок высоты формы. Обязан оставлять место под верхнюю полосу: TOP_MARGIN + FILL_HEIGHT
# не должно превышать 1, иначе форма вылезет за нижнюю границу холста. На всех 45 файлах
# ограничение всё равно даёт ШИРИНА (пара «перёд + зад» шире, чем выше), высота выходит
# 674..854 px, поэтому этот потолок — страховка для будущих файлов, а не рабочая величина.
FILL_HEIGHT = 0.86

# Фон кадра. Исходники поставщика на белом, белый и оставляем — так нормализация
# ничего не придумывает от себя.
BACKGROUND = (255, 255, 255)

WHITE_CUT = 240
MIN_INK_PIXELS = 3

# Формат готового мокапа. Замер 28.08 на пяти худших кадрах: PNG 514-837 КБ,
# WebP q92 — 75-137 КБ при RMSE 1.1-2.3 из 255, то есть глазом не отличить.
# JPEG q92 проигрывает и по весу (107-162 КБ), и по ошибке (1.4-2.6).
# 45 мокапов в PNG это ~30 МБ на мобильном интернете, в WebP — около 5 МБ.
FORMAT = "WEBP"
QUALITY = 92


def plan(mapping, source_dir=None):
    """Карта соответствия -> плоский список задач нормализации.

    Ключи с подчёркиванием (`_`, `_source_dir`, `_batch`, `_rename`,
    `_names_provisional`) — пояснения для человека, а не файлы, поэтому обход
    идёт строго по `lines[*].files`, а не по всем ключам подряд.
    """
    root = Path(source_dir or mapping.get("_source_dir", "."))
    return [
        {"line": line, "src": root / name, "target": target}
        for line, block in mapping["lines"].items()
        for name, target in block["files"].items()
    ]


def ink_bbox(arr, white_cut=WHITE_CUT, min_pixels=MIN_INK_PIXELS):
    """Рамка краски в кадре: (x0, y0, x1, y1) включительно.

    Строка и столбец считаются содержательными, только если краски в них
    набралось не меньше `min_pixels` — иначе одиночная тёмная точка сжатого
    JPEG растянет рамку на весь кадр и запорет масштаб.
    """
    ink = arr.min(axis=2) < white_cut
    rows = np.nonzero(ink.sum(axis=1) >= min_pixels)[0]
    cols = np.nonzero(ink.sum(axis=0) >= min_pixels)[0]
    if not len(rows) or not len(cols):
        raise ValueError("в кадре нет краски: сплошной фон")
    return int(cols[0]), int(rows[0]), int(cols[-1]), int(rows[-1])


def frame(bbox, canvas=CANVAS, fill_height=FILL_HEIGHT, top_margin=TOP_MARGIN):
    """Куда и с каким масштабом положить рамку краски на холст."""
    cw, ch = canvas
    src_w = bbox[2] - bbox[0] + 1
    src_h = bbox[3] - bbox[1] + 1
    scale = min((ch * fill_height) / src_h, cw / src_w)
    width = round(src_w * scale)
    return {
        "scale": scale,
        "left": round((cw - width) / 2),
        "top": round(ch * top_margin),
        "width": round(src_w * scale),
        "height": round(src_h * scale),
    }


def normalize(im, canvas=CANVAS, **kw):
    """Кадр поставщика -> кадр конструктора.

    Возвращает картинку ровно размера холста, где форма стоит в общей рамке.
    Увеличение — Lanczos: нейросетевого апскейлера на машине нет, и ставить его
    в срок заказа я не буду. На 11 файлах из 45 увеличение почти двукратное,
    мягкость на швах и цифрах там будет видна — это вопрос 1 клиенту.
    """
    im = im.convert("RGB")
    box = ink_bbox(np.asarray(im, "uint8"))
    f = frame(box, canvas=canvas, **kw)

    forma = im.crop((box[0], box[1], box[2] + 1, box[3] + 1))
    forma = forma.resize((f["width"], f["height"]), Image.LANCZOS)

    out = Image.new("RGB", canvas, BACKGROUND)
    out.paste(forma, (f["left"], f["top"]))
    return out


def save_mockup(im, path, fmt=FORMAT, quality=QUALITY):
    """Записать готовый кадр и вернуть фактический путь.

    Имя цели в `mockup-map.json` дано БЕЗ расширения намеренно: подставляет его
    только эта функция, поэтому формат задан в одном месте и не может разойтись
    с путями, которые прописывает в конфиг `rewrite_catalog.py`.
    """
    dst = Path(path).with_suffix("." + fmt.lower())
    im.save(dst, fmt, quality=quality, method=6)
    return dst
