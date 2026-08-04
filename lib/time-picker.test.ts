import assert from "node:assert/strict"
import test from "node:test"

import { HOURS, MINUTES, selectHour, selectMinute } from "./time-picker.ts"

test("o seletor oferece todas as 24 horas", () => {
  assert.equal(HOURS.length, 24)
  assert.deepEqual(HOURS, Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0")))
})

test("o seletor oferece cada minuto entre 00 e 59", () => {
  assert.equal(MINUTES.length, 60)
  assert.deepEqual(MINUTES, Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, "0")))
})

test("a escolha de hora preserva o minuto exato sem arredondamento", () => {
  assert.equal(selectHour("14:37:00", "08"), "08:37")
  assert.equal(selectHour("", "23"), "23:00")
})

test("a escolha de minuto preserva a hora e aceita os limites 00 e 59", () => {
  assert.equal(selectMinute("14:37:00", "00"), "14:00")
  assert.equal(selectMinute("14:37:00", "59"), "14:59")
  assert.equal(selectMinute("", "01"), "00:01")
})
