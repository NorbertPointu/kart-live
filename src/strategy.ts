import type { Driver, Phase, PitWindow, PlannedRelay, RaceStrategy } from "./model.ts";

export type StrategyTimelineItem =
  | { kind: "relay"; relay: PlannedRelay; startAt: number; endAt: number }
  | { kind: "pit"; window: PitWindow; startAt: number; endAt: number };

export function generateStrategy(
  strategy: RaceStrategy,
  driverIds: Driver[],
): RaceStrategy {
  if (!driverIds.length) throw new Error("Ajoutez au moins un pilote.");
  const fuelWindows = strategy.fuelWindows.map((window) => ({
    ...window,
    plannedAt: Math.round((window.opensAt + window.closesAt) / 2),
    status: "planned" as const,
  }));
  const drivingMinutes =
    strategy.durationMinutes -
    fuelWindows.reduce((total, window) => total + window.stopMinutes, 0);
  if (drivingMinutes <= 0) throw new Error("Les arrêts dépassent la durée de course.");
  const relayCount = Math.max(
    strategy.minRelays,
    Math.ceil(drivingMinutes / strategy.maxStintMinutes),
  );
  if (relayCount * strategy.minStintMinutes > drivingMinutes)
    throw new Error("Impossible de respecter la durée minimale des relais.");

  const baseDuration = Math.floor(drivingMinutes / relayCount);
  let remainder = drivingMinutes % relayCount;
  const totals = new Map(driverIds.map((driver) => [driver, 0]));
  const relays: PlannedRelay[] = Array.from({ length: relayCount }, (_, index) => {
    const durationMinutes = baseDuration + (remainder-- > 0 ? 1 : 0);
    const driver = driverIds.reduce((leastUsed, candidate) =>
      totals.get(candidate)! < totals.get(leastUsed)! ? candidate : leastUsed,
    );
    totals.set(driver, totals.get(driver)! + durationMinutes);
    return { id: `planned-${index + 1}`, driver, durationMinutes };
  });

  return { ...strategy, fuelWindows, relays };
}

export function moveRelay(
  relays: PlannedRelay[],
  fromIndex: number,
  toIndex: number,
): PlannedRelay[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= relays.length ||
    toIndex >= relays.length
  )
    return relays;
  const reordered = [...relays];
  const [relay] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, relay);
  return reordered;
}

export function resizeRelay(
  strategy: RaceStrategy,
  relayIndex: number,
  durationMinutes: number,
): RaceStrategy {
  const relays = strategy.relays.map((relay) => ({ ...relay }));
  const relay = relays[relayIndex];
  if (!relay) throw new Error("Relais introuvable.");
  const targetDuration = Math.round(durationMinutes);
  if (
    targetDuration < strategy.minStintMinutes ||
    targetDuration > strategy.maxStintMinutes
  )
    throw new Error("La durée doit respecter les limites de relais configurées.");

  let remaining = relay.durationMinutes - targetDuration;
  const following = relays.slice(relayIndex + 1);
  if (strategy.distributionMode === "next") {
    const next = following[0];
    if (!next) throw new Error("Aucun relais suivant pour redistribuer cette durée.");
    const nextDuration = next.durationMinutes + remaining;
    if (nextDuration < strategy.minStintMinutes || nextDuration > strategy.maxStintMinutes)
      throw new Error("Le relais suivant dépasserait ses limites.");
    next.durationMinutes = nextDuration;
  } else {
    let recipients = following;
    while (remaining !== 0 && recipients.length) {
      const weightTotal = recipients.reduce((sum, item) => sum + item.durationMinutes, 0);
      let allocated = 0;
      for (const recipient of recipients) {
        const share = Math.trunc((remaining * recipient.durationMinutes) / weightTotal);
        const minimumChange = strategy.minStintMinutes - recipient.durationMinutes;
        const maximumChange = strategy.maxStintMinutes - recipient.durationMinutes;
        const change = Math.max(minimumChange, Math.min(maximumChange, share));
        recipient.durationMinutes += change;
        allocated += change;
      }
      if (allocated === 0) {
        const recipient = recipients.find((item) =>
          remaining > 0
            ? item.durationMinutes < strategy.maxStintMinutes
            : item.durationMinutes > strategy.minStintMinutes,
        );
        if (!recipient) break;
        const change = remaining > 0 ? 1 : -1;
        recipient.durationMinutes += change;
        allocated = change;
      }
      remaining -= allocated;
      recipients = recipients.filter((item) =>
        remaining > 0
          ? item.durationMinutes < strategy.maxStintMinutes
          : item.durationMinutes > strategy.minStintMinutes,
      );
    }
    if (remaining !== 0)
      throw new Error("Les relais suivants n'ont pas assez de marge pour cette modification.");
  }
  relay.durationMinutes = targetDuration;
  return { ...strategy, relays };
}

export function validateStrategy(strategy: RaceStrategy): string[] {
  const alerts: string[] = [];
  if (strategy.relays.length < strategy.minRelays)
    alerts.push(`Minimum ${strategy.minRelays} relais requis.`);
  const drivingMinutes = strategy.relays.reduce(
    (total, relay) => total + relay.durationMinutes,
    0,
  );
  const stopMinutes = strategy.fuelWindows.reduce(
    (total, window) => total + window.stopMinutes,
    0,
  );
  if (drivingMinutes + stopMinutes !== strategy.durationMinutes)
    alerts.push("Les relais et arrêts ne permettent pas de terminer à l'heure prévue.");
  strategy.relays.forEach((relay, index) => {
    if (
      relay.durationMinutes < strategy.minStintMinutes ||
      relay.durationMinutes > strategy.maxStintMinutes
    )
      alerts.push(`Le relais ${index + 1} dépasse les limites configurées.`);
  });
  strategy.fuelWindows.forEach((window) => {
    if (window.status !== "done" && window.plannedAt === null)
      alerts.push(`${window.label} n'est pas planifié.`);
    else if (
      window.plannedAt !== null &&
      (window.plannedAt < window.opensAt || window.plannedAt > window.closesAt)
    )
      alerts.push(`${window.label} est en dehors de sa fenêtre.`);
  });
  return alerts;
}

export function scheduleQualifying(
  order: Driver[],
  durationMinutes: number,
  karts: number,
  startAt: number,
) {
  const lanes = Math.max(1, Math.floor(karts));
  const waves = Math.ceil(order.length / lanes);
  const slotMinutes = waves ? durationMinutes / waves : 0;
  return order.map((driver, index) => {
    const wave = Math.floor(index / lanes);
    const start = startAt + wave * slotMinutes * 60_000;
    return {
      driver,
      order: index + 1,
      startAt: start,
      endAt: start + slotMinutes * 60_000,
      durationMinutes: slotMinutes,
    };
  });
}

export function buildStrategyTimeline(
  strategy: RaceStrategy,
  anchorStartAt = strategy.scheduledStartAt,
): StrategyTimelineItem[] {
  const shift = anchorStartAt - strategy.scheduledStartAt;
  const stopsAfter = new Map<number, PitWindow[]>();
  let previousStops = 0;
  const windows = strategy.fuelWindows
    .map((window) => ({
      ...window,
      opensAt: window.opensAt + shift,
      closesAt: window.closesAt + shift,
      plannedAt: window.plannedAt === null ? null : window.plannedAt + shift,
    }))
    .sort((a, b) => (a.plannedAt ?? a.opensAt) - (b.plannedAt ?? b.opensAt));

  for (const window of windows) {
    if (window.status === "unplanned" || window.plannedAt === null) continue;
    const drivingTarget =
      (window.plannedAt - anchorStartAt) / 60_000 - previousStops;
    let elapsedDriving = 0;
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    strategy.relays.forEach((relay, index) => {
      elapsedDriving += relay.durationMinutes;
      const distance = Math.abs(elapsedDriving - drivingTarget);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });
    const stops = stopsAfter.get(nearestIndex) ?? [];
    stops.push(window);
    stopsAfter.set(nearestIndex, stops);
    previousStops += window.stopMinutes;
  }

  let cursor = anchorStartAt;
  return strategy.relays.flatMap((relay, index) => {
    const startAt = cursor;
    cursor += relay.durationMinutes * 60_000;
    const items: StrategyTimelineItem[] = [{ kind: "relay", relay, startAt, endAt: cursor }];
    for (const window of stopsAfter.get(index) ?? []) {
      const stopStart = cursor;
      cursor += window.stopMinutes * 60_000;
      items.push({ kind: "pit", window, startAt: stopStart, endAt: cursor });
    }
    return items;
  });
}

export function plannedDriverAt(
  strategy: RaceStrategy,
  phase: Phase,
  now: number,
  qualificationStartAt: number | null,
  raceStartAt: number | null,
): Driver | null {
  if (phase === "qualifying") {
    const qualifyingStart =
      qualificationStartAt ??
      strategy.scheduledStartAt - strategy.qualifyingMinutes * 60_000;
    const currentSlot = scheduleQualifying(
      strategy.qualifyingOrder,
      strategy.qualifyingMinutes,
      strategy.qualifyingKarts,
      qualifyingStart,
    ).find((slot) => now >= slot.startAt && now < slot.endAt);
    return (
      currentSlot?.driver ??
      strategy.qualifyingOrder.find(
        (driver) => !strategy.qualifyingDone.includes(driver),
      ) ??
      null
    );
  }

  const firstRelay = strategy.relays[0]?.driver ?? null;
  if (raceStartAt === null || now < raceStartAt) return firstRelay;
  const timeline = buildStrategyTimeline(strategy, raceStartAt);
  const currentIndex = timeline.findIndex(
    (item) => now >= item.startAt && now < item.endAt,
  );
  if (currentIndex < 0) return null;
  const currentItem = timeline[currentIndex];
  if (currentItem.kind === "relay") return currentItem.relay.driver;
  return (
    timeline
      .slice(0, currentIndex)
      .reverse()
      .find((item) => item.kind === "relay")?.relay.driver ?? null
  );
}

export function nextPlannedDriverAt(
  strategy: RaceStrategy,
  phase: Phase,
  now: number,
  qualificationStartAt: number | null,
  raceStartAt: number | null,
): Driver | null {
  if (phase === "qualifying") {
    const startAt =
      qualificationStartAt ??
      strategy.scheduledStartAt - strategy.qualifyingMinutes * 60_000;
    const slots = scheduleQualifying(
      strategy.qualifyingOrder,
      strategy.qualifyingMinutes,
      strategy.qualifyingKarts,
      startAt,
    );
    const currentSlot = slots.find(
      (slot) => now >= slot.startAt && now < slot.endAt,
    );
    const nextSlot = slots.find(
      (slot) =>
        slot.startAt > now &&
        !strategy.qualifyingDone.includes(slot.driver) &&
        (!currentSlot || slot.startAt >= currentSlot.endAt),
    );
    return (
      nextSlot?.driver ??
      slots.find(
        (slot) =>
          slot.endAt > now && !strategy.qualifyingDone.includes(slot.driver),
      )?.driver ??
      null
    );
  }

  const timeline = buildStrategyTimeline(
    strategy,
    raceStartAt ?? strategy.scheduledStartAt,
  );
  const plannedRelays = timeline.filter(
    (item): item is Extract<StrategyTimelineItem, { kind: "relay" }> =>
      item.kind === "relay",
  );
  if (raceStartAt === null || now < raceStartAt)
    return plannedRelays[1]?.relay.driver ?? null;

  const currentIndex = timeline.findIndex(
    (item) => now >= item.startAt && now < item.endAt,
  );
  const upcomingRelay = timeline
    .slice(currentIndex + 1)
    .find((item) => item.kind === "relay");
  if (upcomingRelay?.kind === "relay") return upcomingRelay.relay.driver;
  if (currentIndex >= 0) return null;
  return plannedRelays.find((item) => item.startAt > now)?.relay.driver ?? null;
}

export function pitWindowAt(window: PitWindow, at: number): PitWindow {
  return {
    ...window,
    plannedAt: at,
    status: at >= window.opensAt && at <= window.closesAt ? "planned" : "unplanned",
  };
}