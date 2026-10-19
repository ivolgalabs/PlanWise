// Запуск: node scripts/quickAdd.check.mjs
import assert from "node:assert/strict";
import { parseQuickAdd as p, quickTask } from "../src/quickAdd.ts";

const eq = (s, title, dayOffset, timeMinutes) => assert.deepEqual(p(s), { title, dayOffset, timeMinutes }, s);
eq("Позвонить маме", "Позвонить маме", null, null);
eq("Завтра созвон в 15:00", "созвон", 1, 900);
eq("созвон завтра в 9", "созвон", 1, 540);
eq("в 18:30 зал", "зал", null, 1110);
eq("сдать отчёт послезавтра", "сдать отчёт", 2, null);
eq("Call Anna tomorrow at 14:05", "Call Anna", 1, 845);
eq("Купить 5 яблок", "Купить 5 яблок", null, null);
eq("встреча в 25:00", "встреча в 25:00", null, null);
eq("завтра", "завтра", null, null);
eq("в 15:00", "в 15:00", null, null);
eq("Сегодня купить завтра хлеб", "купить завтра хлеб", 0, null);
assert.deepEqual(quickTask("завтра йога 7:30", 100, 50), { title: "йога", date: 51, timeMinutes: 450 });
assert.deepEqual(quickTask("йога", 100, 50), { title: "йога", date: 100, timeMinutes: null });
console.log("quickAdd: ok");
