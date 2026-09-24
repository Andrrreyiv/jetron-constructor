# -*- coding: utf-8 -*-
"""Порядок шрифтов в админке (PHP) обязан совпадать с порядком у покупателя (JS).

Список шрифтов один, но рисуют его два разных кода: таблицу в админке — PHP из
`deploy/jetron-admin.php`, палитру у покупателя — `упорядочитьШрифты` в
`src/js/core/AdminOverrides.js`. Разъедутся — владелец и покупатель увидят разные
списки, и правка окажется половинчатой.

☠️ Так уже было 24.09 на боевом: `strnatcasecmp` пропускает пробелы, и админка ставила
«Manchester City 23-24» впереди «Man City 24/25», а «BarcelonaLaliga-Regular» впереди
«Barcelona La Liga 2023 2024». На тестовом составе из 25 шрифтов дефект не проявлялся,
поймал его только замер на живых 43. Отсюда и набор имён ниже: он состоит из ловушек.

Тест поднимает НАСТОЯЩИЙ код плагина: функции вытаскиваются из файла и выполняются
через php. Если php в системе нет, тест пропускается — он страхует, но не обязан
блокировать прогон там, где PHP не установлен.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile

import pytest

КОРЕНЬ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ПЛАГИН = os.path.join(КОРЕНЬ, "deploy", "jetron-admin.php")

# (имя, есть ли кириллица). Порядок нарочно перемешан.
ШРИФТЫ = [
    ("РПЛ", True),
    ("Oswald", True),
    ("Manchester City 23-24", False),
    ("Man City 24/25", False),
    ("Manchester United 20-21", False),
    ("Man United 23/24", False),
    ("BarcelonaLaliga-Regular", False),
    ("Barcelona La Liga 2023 2024", False),
    ("Brazil 2024", False),
    ("Brazil 2021", False),
    ("Brazil WC 2022", False),
    ("Real Madrid 2021", False),
    ("Real Madrid 21/22", False),
    ("AL Hilal 2023 2024", False),
    ("Adventor", False),
]

# Тот же порядок, что даёт localeCompare(…, {numeric: true, sensitivity: 'base'})
# в конструкторе. Сверено с ним напрямую 24.09.
ОЖИДАЕМЫЙ = [
    "РПЛ", "Oswald",                       # кириллица первой и в исходном порядке
    "Adventor",
    "AL Hilal 2023 2024",
    "Barcelona La Liga 2023 2024",         # пробел раньше буквы
    "BarcelonaLaliga-Regular",
    "Brazil 2021",                         # числа сравниваются числами
    "Brazil 2024",
    "Brazil WC 2022",
    "Man City 24/25",                      # ловушка: «Man » раньше «Manchester»
    "Man United 23/24",
    "Manchester City 23-24",
    "Manchester United 20-21",
    "Real Madrid 21/22",                   # 21 раньше 2021
    "Real Madrid 2021",
]

ПРОГОН = """<?php
%s
%s
$имена = json_decode(file_get_contents($argv[1]), true);
$шрифты = array();
foreach ($имена as $п) {
    $шрифты[] = array('id' => md5($п[0]), 'name' => $п[0], 'file' => 'f.ttf', 'cyrillic' => (bool) $п[1]);
}
$из = array();
foreach (jetron_admin_sort_fonts($шрифты) as $f) { $из[] = $f['name']; }
echo json_encode($из, JSON_UNESCAPED_UNICODE);
"""


def _php():
    for кандидат in (r"C:\tools\php82\php.exe", "php"):
        найден = shutil.which(кандидат) or (кандидат if os.path.exists(кандидат) else None)
        if найден:
            return найден
    return None


def _функция(исходник, имя):
    # Функции верхнего уровня заканчиваются «}» в первой колонке; вложенные скобки
    # внутри (замыкание в usort) всегда с отступом, поэтому якорь надёжен.
    m = re.search(r"^function %s.*?^\}$" % имя, исходник, re.S | re.M)
    assert m, "в плагине не найдена функция %s" % имя
    return m.group(0)


def test_порядок_шрифтов_в_админке_совпадает_с_конструктором():
    php = _php()
    if not php:
        pytest.skip("php не найден — проверку порядка в админке пропускаем")

    исходник = open(ПЛАГИН, encoding="utf-8").read().replace("\r\n", "\n")
    скрипт = ПРОГОН % (_функция(исходник, "jetron_admin_font_cmp"),
                       _функция(исходник, "jetron_admin_sort_fonts"))

    каталог = tempfile.mkdtemp()
    путь_скрипта = os.path.join(каталог, "порядок.php")
    путь_данных = os.path.join(каталог, "шрифты.json")
    with open(путь_скрипта, "wb") as f:
        f.write(скрипт.encode("utf-8"))
    with open(путь_данных, "wb") as f:
        f.write(json.dumps(ШРИФТЫ, ensure_ascii=False).encode("utf-8"))

    вывод = subprocess.run([php, путь_скрипта, путь_данных],
                           capture_output=True, text=True, encoding="utf-8")
    assert вывод.returncode == 0, "php упал: %s" % (вывод.stderr or вывод.stdout)
    assert json.loads(вывод.stdout) == ОЖИДАЕМЫЙ
