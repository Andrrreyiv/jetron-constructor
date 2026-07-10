// node:test custom reporter → пишет результаты в формат tdd-guard (test.json).
// Нужен, потому что для встроенного node:test нет готового пакета-репортёра tdd-guard.
// Схема: { testModules:[{moduleId, tests:[{name,fullName,state,errors[]}]}], reason }.
import fs from 'node:fs/promises';
import path from 'node:path';
import { inspect } from 'node:util';

// Разворачиваем цепочку .cause до самой первой (корневой) ошибки —
// при падении загрузки ESM-модуля реальная причина (missing export) лежит в cause,
// а верхний ERR_TEST_FAILURE несёт бесполезное "test failed".
function deepestError(err) {
  let cur = err;
  const seen = new Set();
  while (cur && cur.cause && !seen.has(cur.cause)) {
    seen.add(cur);
    cur = cur.cause;
  }
  return cur ?? err;
}

// Claude Code запускается из C:\Projects, tdd-guard читает ./.claude/tdd-guard/data/test.json там.
// npm test выполняется в jetron-constructor → родитель (..) = C:\Projects.
const DATA_FILE = path.resolve(process.cwd(), '..', '.claude', 'tdd-guard', 'data', 'test.json');

// Сбой на этапе линковки ESM-модуля (например, import несуществующего export)
// не попадает в структурированный details.error — его текст идёт только в stderr
// подпроцесса. Копим stderr и подмешиваем в сообщение файлового падения,
// иначе guard видит бесполезное "test failed" без имени символа.
const MEANINGFUL_STDERR = /(does not provide an export|ERR_MODULE_NOT_FOUND|ReferenceError|is not defined|SyntaxError|Cannot find module|is not a function)/;

export default async function* reporter(source) {
  const tests = [];
  let anyFail = false;
  const stderrBuf = [];

  for await (const event of source) {
    if (event.type === 'test:stderr') stderrBuf.push(String(event.data.message ?? ''));

    if (event.type === 'test:pass' || event.type === 'test:fail') {
      const { name, details, file } = event.data;
      const failed = event.type === 'test:fail';
      if (failed) anyFail = true;
      const entry = { name, fullName: name, state: failed ? 'failed' : 'passed' };
      if (failed) {
        const root = deepestError(details?.error ?? {});
        const topMsg = String(details?.error?.message ?? '');
        const rootMsg = String(root.message ?? root.cause ?? '');
        let message = rootMsg && rootMsg !== topMsg ? `${topMsg}: ${rootMsg}` : (rootMsg || topMsg || 'failed');
        // Для общего "test failed" вытягиваем реальную причину из stderr.
        if (/test failed/i.test(message)) {
          const clue = stderrBuf.map(s => s.trim()).filter(s => MEANINGFUL_STDERR.test(s));
          if (clue.length) message = `${message}: ${clue.join(' | ')}`;
        }
        entry.errors = [{ message, stack: String(root.stack ?? details?.error?.stack ?? inspect(details?.error ?? {})) }];
      }
      entry._file = file;
      tests.push(entry);
    }
    // прозрачно прокидываем в stdout, чтобы обычный вывод тестов сохранился
    if (event.type === 'test:stdout') yield event.data.message;
    if (event.type === 'test:stderr') yield event.data.message;
  }

  const byModule = new Map();
  for (const t of tests) {
    const moduleId = t._file || 'unknown';
    delete t._file;
    if (!byModule.has(moduleId)) byModule.set(moduleId, []);
    byModule.get(moduleId).push(t);
  }
  const testModules = [...byModule].map(([moduleId, tests]) => ({ moduleId, tests }));
  const result = { testModules, reason: anyFail ? 'failed' : 'passed' };

  try {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(result, null, 2), 'utf8');
  } catch {
    // не мешаем тестам падать из-за I/O
  }

  yield `\n[tdd-guard-reporter] ${tests.length} tests, reason=${result.reason}\n`;
}
