// Порядок моделей: что админ видит в таблице, то покупатель видит в конструкторе.
//
// Клиент 13.09: «а здесь можно делать сортировку, чтобы я мог менять местами… первый стоит
// Чемпион и кнопка размера только детская, а взрослой как будто нет». Поводом был реальный
// перекос: у Champion взрослой нет ни в одной из шести расцветок (замер боевого 13.09),
// а он открывался первым. Теперь порядок правится в админке кнопками ↑ ↓ «в начало».
//
// 🔴 Вся затея держится на одном: `admin.json` задаёт ПОРЯДОК, а не только состав. Перестанет —
// админ будет двигать строки, а у покупателя ничего не изменится, и понять это по коду нельзя.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyAdminOverrides } from '../src/js/core/AdminOverrides.js';

const форма = (id, line) => ({
  id, line, colorId: 'white', color: 'Белый', images: { front: 'assets/mockups/' + id + '.webp' },
});
const база = {
  forms: [форма('champion-white', 'Champion'), форма('new-white', 'New'), форма('winner-white', 'Winner')],
  prices: { placement: {}, discounts: {} }, sizes: {}, fonts: [], colors: [],
};

test('порядок форм берётся из админки, а не из базового конфига', () => {
  const admin = { forms: [форма('new-white', 'New'), форма('champion-white', 'Champion'), форма('winner-white', 'Winner')] };
  const out = applyAdminOverrides(база, admin);
  assert.deepEqual(out.forms.map((f) => f.id), ['new-white', 'champion-white', 'winner-white']);
});

// Первая строка таблицы — это модель, которую покупатель увидит при входе. Ради неё всё и затевалось.
test('первой идёт та модель, что стоит первой в админке', () => {
  const admin = { forms: [форма('winner-white', 'Winner'), форма('champion-white', 'Champion')] };
  assert.equal(applyAdminOverrides(база, admin).forms[0].id, 'winner-white');
});

// Пустой список из админки означает «не трогай»: иначе одна случайная очистка стёрла бы
// каталог у покупателей. Правило уже было, но теперь от него зависит и порядок.
test('пустой каталог из админки не стирает базовый', () => {
  assert.deepEqual(applyAdminOverrides(база, { forms: [] }).forms.map((f) => f.id),
    база.forms.map((f) => f.id));
  assert.deepEqual(applyAdminOverrides(база, {}).forms.map((f) => f.id),
    база.forms.map((f) => f.id));
});

// Битая запись выбрасывается, но ПОРЯДОК уцелевших сохраняется — иначе перестановка
// «в начало» после неудачной загрузки модели давала бы непредсказуемый результат.
test('битая модель выбрасывается, порядок остальных цел', () => {
  const admin = { forms: [форма('new-white', 'New'), { id: 'без-линейки' }, форма('champion-white', 'Champion')] };
  assert.deepEqual(applyAdminOverrides(база, admin).forms.map((f) => f.id),
    ['new-white', 'champion-white']);
});

// Сама перестановка живёт в mu-плагине (PHP), в node:test её не выполнить. Тест стережёт
// то, что можно проверить по исходнику: действие на месте и не лишилось страховок.
test('в админке есть перестановка и она не потеряла страховки', () => {
  const php = readFileSync(new URL('../deploy/jetron-admin.php', import.meta.url), 'utf8');
  assert.match(php, /\$action === 'model_move'/, 'действие перестановки пропало');
  for (const куда of ["'up'", "'down'", "'top'"]) {
    assert.ok(php.includes(куда), `направление ${куда} пропало`);
  }
  // Счёт моделей до и после: без него ошибка в array_splice молча укоротила бы каталог.
  assert.match(php, /\$было\s*=\s*count\(\$forms\)/, 'пропала страховка «число моделей до»');
  assert.match(php, /count\(\$forms\) !== \$было/, 'страховка перестала сравнивать');
  // Раздела forms в admin.json может ещё не быть — тогда берём базовый каталог целиком,
  // иначе первая же перестановка записала бы список из одной модели.
  assert.match(php, /jetron_admin_base_forms\(\)/, 'пропал запасной путь на базовый каталог');
});
