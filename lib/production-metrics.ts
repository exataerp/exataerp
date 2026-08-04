export type ProductionTimeUnit = "seconds" | "minutes" | "hours" | "s" | "min" | "h"

export interface TimedOperation {
  time: number
  unit: ProductionTimeUnit
  setupTime?: number
  name?: string
}

export interface RouteMetrics {
  totalSeconds: number
  averageSeconds: number
  bottleneckSeconds: number
  bottleneckIndex: number | null
  bottleneckName: string | null
}

export interface OeeInput {
  scheduledSeconds: number
  runningSeconds: number
  theoreticalSeconds: number
  totalUnits: number
  goodUnits: number
}

export interface OeeResult {
  availability: number
  performance: number
  quality: number
  oee: number
  calculable: boolean
}

const finiteNonNegative = (value: number) =>
  Number.isFinite(value) ? Math.max(0, value) : 0

export function timeToSeconds(value: number, unit: ProductionTimeUnit): number {
  const normalized = finiteNonNegative(value)
  if (unit === "hours" || unit === "h") return normalized * 3600
  if (unit === "minutes" || unit === "min") return normalized * 60
  return normalized
}

export function secondsToTime(value: number, unit: ProductionTimeUnit): number {
  const normalized = finiteNonNegative(value)
  if (unit === "hours" || unit === "h") return normalized / 3600
  if (unit === "minutes" || unit === "min") return normalized / 60
  return normalized
}

export function calculateRouteMetrics(operations: TimedOperation[]): RouteMetrics {
  if (operations.length === 0) {
    return {
      totalSeconds: 0,
      averageSeconds: 0,
      bottleneckSeconds: 0,
      bottleneckIndex: null,
      bottleneckName: null,
    }
  }

  const seconds = operations.map(operation => timeToSeconds(operation.time, operation.unit))
  const totalSeconds = seconds.reduce((total, value) => total + value, 0)
  const bottleneckSeconds = Math.max(...seconds)
  const bottleneckIndex = seconds.indexOf(bottleneckSeconds)

  return {
    totalSeconds,
    averageSeconds: totalSeconds / operations.length,
    bottleneckSeconds,
    bottleneckIndex,
    bottleneckName: operations[bottleneckIndex]?.name ?? null,
  }
}

/**
 * Takt depende de calendario e demanda. Retorna null quando uma das bases nao
 * existe, evitando usar gargalo ou media como substituto silencioso.
 */
export function calculateTaktSeconds(
  availableSeconds: number | null | undefined,
  demandUnits: number | null | undefined,
): number | null {
  if (!availableSeconds || !demandUnits || availableSeconds <= 0 || demandUnits <= 0) {
    return null
  }
  return availableSeconds / demandUnits
}

/** Tempo planejado da ordem: ciclo sequencial por unidade + setup do roteiro. */
export function calculatePlannedOrderSeconds(
  operations: TimedOperation[],
  quantity: number,
  groupSetup = false,
): number {
  const route = calculateRouteMetrics(operations)
  const setups = operations.map(operation =>
    timeToSeconds(operation.setupTime ?? 0, operation.unit),
  )
  const setupSeconds = groupSetup
    ? Math.max(0, ...setups)
    : setups.reduce((total, value) => total + value, 0)

  return route.totalSeconds * finiteNonNegative(quantity) + setupSeconds
}

export function calculateOee(input: OeeInput): OeeResult {
  const scheduledSeconds = finiteNonNegative(input.scheduledSeconds)
  const runningSeconds = finiteNonNegative(input.runningSeconds)
  const theoreticalSeconds = finiteNonNegative(input.theoreticalSeconds)
  const totalUnits = finiteNonNegative(input.totalUnits)
  const goodUnits = Math.min(finiteNonNegative(input.goodUnits), totalUnits)

  const calculable = scheduledSeconds > 0 && runningSeconds > 0 && totalUnits > 0 && theoreticalSeconds > 0
  if (!calculable) {
    return { availability: 0, performance: 0, quality: 0, oee: 0, calculable: false }
  }

  const availability = Math.min(1, runningSeconds / scheduledSeconds)
  const performance = Math.min(1, theoreticalSeconds / runningSeconds)
  const quality = Math.min(1, goodUnits / totalUnits)

  return {
    availability: availability * 100,
    performance: performance * 100,
    quality: quality * 100,
    oee: availability * performance * quality * 100,
    calculable: true,
  }
}

export function aggregateOeeInputs(inputs: OeeInput[]): OeeInput {
  return inputs.reduce<OeeInput>((total, input) => ({
    scheduledSeconds: total.scheduledSeconds + finiteNonNegative(input.scheduledSeconds),
    runningSeconds: total.runningSeconds + finiteNonNegative(input.runningSeconds),
    theoreticalSeconds: total.theoreticalSeconds + finiteNonNegative(input.theoreticalSeconds),
    totalUnits: total.totalUnits + finiteNonNegative(input.totalUnits),
    goodUnits: total.goodUnits + finiteNonNegative(input.goodUnits),
  }), {
    scheduledSeconds: 0,
    runningSeconds: 0,
    theoreticalSeconds: 0,
    totalUnits: 0,
    goodUnits: 0,
  })
}
