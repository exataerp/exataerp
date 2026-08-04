import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  aggregateOeeInputs,
  calculateOee,
  calculatePlannedOrderSeconds,
  calculateRouteMetrics,
  calculateTaktSeconds,
} from "./production-metrics.ts"

describe("Métricas industriais canônicas", () => {
  it("separa total, média e gargalo no roteiro real do produto 2040", () => {
    const metrics = calculateRouteMetrics(
      [10, 7, 11, 31, 14, 15].map((time, index) => ({
        name: `Operação ${index + 1}`,
        time,
        unit: "seconds" as const,
      })),
    )

    assert.equal(metrics.totalSeconds, 88)
    assert.equal(metrics.averageSeconds, 88 / 6)
    assert.equal(metrics.bottleneckSeconds, 31)
    assert.equal(metrics.bottleneckName, "Operação 4")
  })

  it("não inventa takt a partir do roteiro", () => {
    assert.equal(calculateTaktSeconds(undefined, 100), null)
    assert.equal(calculateTaktSeconds(28_800, undefined), null)
    assert.equal(calculateTaktSeconds(28_800, 480), 60)
  })

  it("calcula tempo planejado pela soma sequencial, sem usar média ou gargalo", () => {
    const operations = [
      { name: "Corte", time: 10, setupTime: 120, unit: "seconds" as const },
      { name: "Costura", time: 20, setupTime: 60, unit: "seconds" as const },
    ]

    assert.equal(calculatePlannedOrderSeconds(operations, 100, false), 3_180)
    assert.equal(calculatePlannedOrderSeconds(operations, 100, true), 3_120)
  })

  it("agrega OEE pelos totais ponderados, não pela média simples das máquinas", () => {
    const maquinaLonga = {
      scheduledSeconds: 36_000,
      runningSeconds: 30_000,
      theoreticalSeconds: 27_000,
      totalUnits: 1_000,
      goodUnits: 990,
    }
    const maquinaCurta = {
      scheduledSeconds: 3_600,
      runningSeconds: 1_800,
      theoreticalSeconds: 900,
      totalUnits: 10,
      goodUnits: 5,
    }

    const mediaSimples = (calculateOee(maquinaLonga).oee + calculateOee(maquinaCurta).oee) / 2
    const consolidado = calculateOee(aggregateOeeInputs([maquinaLonga, maquinaCurta]))

    assert.equal(consolidado.calculable, true)
    assert.notEqual(consolidado.oee, mediaSimples)
    assert.ok(consolidado.oee > mediaSimples)
  })

  it("não publica OEE quando falta tempo padrão confiável", () => {
    assert.deepEqual(calculateOee({
      scheduledSeconds: 28_800,
      runningSeconds: 20_000,
      theoreticalSeconds: 0,
      totalUnits: 100,
      goodUnits: 99,
    }), {
      availability: 0,
      performance: 0,
      quality: 0,
      oee: 0,
      calculable: false,
    })
  })
})
