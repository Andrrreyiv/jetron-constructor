# -*- coding: utf-8 -*-
"""Контракт нормализации мокапов.

Смысл нормализации не в том, чтобы получить 45 файлов 900x1200 — это следствие.
Смысл в том, чтобы форма во ВСЕХ кадрах встала в ОДНУ И ТУ ЖЕ геометрическую рамку.
Зоны нанесения заданы долями 0..1 от холста, поэтому одинаковая рамка = зоны
переносимы, и расставлять их надо один раз на линейку, а не 45 раз.

Поэтому здесь проверяется именно рамка, а не «картинка открылась».
"""
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from normalize_mockups import (  # noqa: E402
    CANVAS,
    FILL_HEIGHT,
    frame,
    ink_bbox,
    normalize,
    plan,
    save_mockup,
)


def canvas_with(box, size=(1920, 1920), fill=(20, 30, 200)):
    """Белый кадр с одним тёмным прямоугольником — подделка формы на белом фоне."""
    im = Image.new("RGB", size, "white")
    im.paste(Image.new("RGB", (box[2] - box[0], box[3] - box[1]), fill), (box[0], box[1]))
    return im


КАРТА = {
    "_": "служебный ключ верхнего уровня",
    "_source_dir": "C:/тест",
    "lines": {
        "Winner": {
            "_batch": "служебный ключ внутри линейки",
            "files": {"a.jpg": "Winner белый", "b.jpg": "Winner синий"},
        },
        "Волна": {
            "_names_provisional": "имена придуманы нами",
            "files": {"c.jpg": "Волна красная"},
        },
    },
}


class TestPlan:
    def test_разворачивает_карту_в_задачи_без_служебных_ключей(self):
        """Ключи с подчёркиванием — комментарии для человека, а не файлы.
        Взять их за исходники значит уронить прогон на несуществующем пути."""
        задачи = plan(КАРТА)
        assert [(t["line"], t["target"]) for t in задачи] == [
            ("Winner", "Winner белый"),
            ("Winner", "Winner синий"),
            ("Волна", "Волна красная"),
        ]


class TestInkBbox:
    def test_находит_рамку_краски_на_белом(self):
        a = np.asarray(canvas_with((100, 200, 500, 900)), "uint8")
        assert ink_bbox(a) == (100, 200, 499, 899)

    def test_накрывает_перёд_и_зад_одной_рамкой(self):
        """В кадре поставщика слева перёд, справа зад. Резать пополам нельзя —
        клиент это опроверг 23.08. Рамка обязана накрыть оба объекта сразу."""
        im = canvas_with((100, 200, 500, 900))
        im.paste(Image.new("RGB", (400, 700), (20, 30, 200)), (900, 250))
        a = np.asarray(im, "uint8")
        assert ink_bbox(a) == (100, 200, 1299, 949)

    def test_не_ведётся_на_одиночный_шум_jpeg(self):
        """У сжатого JPEG в белом поле попадаются одиночные тёмные точки.
        Клюнуть на них — значит растянуть рамку на весь кадр и запороть масштаб."""
        im = canvas_with((100, 200, 500, 900))
        im.putpixel((5, 5), (100, 100, 100))
        im.putpixel((1900, 1900), (100, 100, 100))
        a = np.asarray(im, "uint8")
        assert ink_bbox(a) == (100, 200, 499, 899)

    def test_видит_белую_форму_по_контуру(self):
        """Белые расцветки есть в шести линейках. Полотно почти сливается с фоном,
        но контур и тень всегда темнее — на них и держится рамка."""
        im = Image.new("RGB", (1920, 1920), "white")
        im.paste(Image.new("RGB", (400, 700), (200, 200, 200)), (100, 200))
        im.paste(Image.new("RGB", (396, 696), (252, 252, 252)), (102, 202))
        a = np.asarray(im, "uint8")
        assert ink_bbox(a) == (100, 200, 499, 899)


class TestFrame:
    def test_форма_занимает_заданную_долю_высоты(self):
        f = frame((0, 0, 580, 1000))
        assert f["height"] == pytest.approx(CANVAS[1] * FILL_HEIGHT, abs=1)

    def test_центрируется_по_горизонтали(self):
        f = frame((0, 0, 580, 1000))
        assert f["left"] == pytest.approx((CANVAS[0] - f["width"]) / 2, abs=1)

    def test_одна_рамка_для_разных_пропорций(self):
        """Главный инвариант. Пропорция формы гуляет 0.48..0.62 по линейкам.
        Верх и высота обязаны совпасть у всех, иначе номер и логотипы поедут
        при переключении расцветки."""
        узкая = frame((0, 0, 480, 1000))
        широкая = frame((0, 0, 620, 1000))
        assert узкая["top"] == широкая["top"]
        assert узкая["height"] == широкая["height"]

    def test_широкую_форму_не_выпускает_за_кадр(self):
        """Страховка. Если попадётся кадр шире холста, вписываем по ширине:
        лучше нарушить единую высоту у одного файла, чем обрезать ему рукава."""
        f = frame((0, 0, 2000, 1000))
        assert f["width"] <= CANVAS[0]
        assert f["left"] >= 0


class TestNormalize:
    def test_отдаёт_ровно_холст(self):
        assert normalize(canvas_with((100, 200, 500, 900))).size == CANVAS

    def test_ставит_форму_в_обещанную_рамку(self):
        """Сквозная проверка: то, что посчитал frame, реально оказалось на картинке."""
        src = canvas_with((100, 200, 500, 900))
        ожидание = frame(ink_bbox(np.asarray(src, "uint8")))
        got = ink_bbox(np.asarray(normalize(src), "uint8"))
        assert got[1] == pytest.approx(ожидание["top"], abs=2)
        assert got[3] - got[1] + 1 == pytest.approx(ожидание["height"], abs=2)

    def test_разные_пропорции_садятся_одинаково(self):
        """Тот же инвариант, что и в TestFrame, но уже на пикселях, а не на
        арифметике: проверяем готовую картинку, а не намерение."""
        a = ink_bbox(np.asarray(normalize(canvas_with((100, 200, 480, 1200))), "uint8"))
        b = ink_bbox(np.asarray(normalize(canvas_with((700, 50, 1320, 1050))), "uint8"))
        assert a[1] == pytest.approx(b[1], abs=2)
        assert a[3] == pytest.approx(b[3], abs=2)


class TestSaveMockup:
    def test_сохраняет_в_webp_а_не_в_png(self, tmp_path):
        """Мокап — фотография, а PNG её не жмёт: замер 28.08 на пяти худших дал
        514-837 КБ, то есть 45 файлов = около 30 МБ на мобильном интернете, и 18
        файлов вылетели за бюджет приёмки в 600 КБ.

        WebP q92 на тех же пяти: 75-137 КБ при RMSE 1.1-2.3 из 255 — разницы
        глазом нет, вес падает вшестеро. JPEG q92 хуже по обоим показателям
        (107-162 КБ, RMSE 1.4-2.6). WebP в проекте уже проверен: `Rich белая.webp`
        лежал в боевом наборе и открывался.

        Формат — часть контракта приёмки, а не деталь реализации: имя цели в
        `mockup-map.json` даётся без расширения, и подставляет его именно эта
        функция, поэтому промах здесь молча разошёлся бы с путями в конфиге.
        """
        dst = save_mockup(normalize(canvas_with((100, 200, 500, 900))), tmp_path / "Champion белый")
        assert dst.suffix == ".webp"
        with Image.open(dst) as saved:
            assert saved.format == "WEBP"
            assert saved.size == CANVAS
