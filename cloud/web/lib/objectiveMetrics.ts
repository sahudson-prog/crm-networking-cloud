import type { ContactRow, InteractionParticipantRow, InteractionRow, ObjectivePriority, ObjectiveRow, ObjectiveType } from "./readModel";

export type ObjectiveMetricRow = {
  objectiveId: string;
  objectiveName: string;
  objectiveType: ObjectiveType;
  priorityLevel: ObjectivePriority;
  contactCount: number;
  focusContactCount: number;
  coffeeCount: number;
  lastInteractionAt: string | null;
  daysSinceLastInteraction: number | null;
  networkingStatus: string;
};

export type ObjectiveMetricInput = {
  objectives: ObjectiveRow[];
  contacts: ContactRow[];
  interactions: InteractionRow[];
  participants: InteractionParticipantRow[];
  networkingStartDate?: Date | null;
  today?: Date;
};

const PRIORITY_RANK: Record<ObjectivePriority, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2
};

const TYPE_RANK: Record<ObjectiveType, number> = {
  INDUSTRY: 0,
  COMPANY: 1,
  ROLE: 2,
  FUNCTION: 3
};

const NETWORKING_STATUS_ORDER = [
  "Pendiente",
  "Contactado",
  "Agendado",
  "Cita concretada",
  "Agradecimiento enviado"
];

export function buildObjectiveMetrics(input: ObjectiveMetricInput): ObjectiveMetricRow[] {
  const activeObjectives = input.objectives.filter((objective) => objective.is_active);
  const objectiveIds = new Set(activeObjectives.map((objective) => objective.id));
  const metricByObjective = new Map(
    activeObjectives.map((objective) => [
      objective.id,
      {
        objectiveId: objective.id,
        objectiveName: objective.objective_name,
        objectiveType: objective.objective_type,
        priorityLevel: objective.priority_level,
        contactIds: new Set<string>(),
        focusContactIds: new Set<string>(),
        coffeeInteractionIds: new Set<string>(),
        lastInteractionAt: null as string | null,
        networkingStatus: ""
      }
    ])
  );
  const objectiveIdsByContact = new Map<string, Set<string>>();

  for (const contact of input.contacts) {
    if (!contact.is_active) continue;
    const assignedObjectiveIds = new Set(
      (contact.contact_objective_assignments ?? [])
        .map((assignment) => assignment.objective_id)
        .filter((objectiveId) => objectiveIds.has(objectiveId))
    );
    if (!assignedObjectiveIds.size) continue;

    objectiveIdsByContact.set(contact.id, assignedObjectiveIds);
    for (const objectiveId of assignedObjectiveIds) {
      const metric = metricByObjective.get(objectiveId);
      if (!metric) continue;
      metric.contactIds.add(contact.id);
      if (contact.networking_focus) metric.focusContactIds.add(contact.id);
      metric.networkingStatus = mostAdvancedStatus(metric.networkingStatus, contact.networking_status);
    }
  }

  const interactionById = new Map(input.interactions.map((interaction) => [interaction.id, interaction]));
  const minimumActivityDate = input.networkingStartDate ? dateValueFromDate(input.networkingStartDate) : 0;
  for (const participant of input.participants) {
    if (!participant.contact_id) continue;
    const participantObjectiveIds = objectiveIdsByContact.get(participant.contact_id);
    if (!participantObjectiveIds?.size) continue;
    const interaction = interactionById.get(participant.interaction_id);
    if (!interaction?.occurred_at) continue;
    if (!isCoffeeInteraction(interaction)) continue;
    if (minimumActivityDate && dateValue(interaction.occurred_at) < minimumActivityDate) continue;

    for (const objectiveId of participantObjectiveIds) {
      const metric = metricByObjective.get(objectiveId);
      if (!metric) continue;
      metric.coffeeInteractionIds.add(interaction.id);
      if (!metric.lastInteractionAt || dateValue(interaction.occurred_at) > dateValue(metric.lastInteractionAt)) {
        metric.lastInteractionAt = interaction.occurred_at;
      }
    }
  }

  const today = input.today ?? new Date();
  return Array.from(metricByObjective.values())
    .map((metric) => ({
      objectiveId: metric.objectiveId,
      objectiveName: metric.objectiveName,
      objectiveType: metric.objectiveType,
      priorityLevel: metric.priorityLevel,
      contactCount: metric.contactIds.size,
      focusContactCount: metric.focusContactIds.size,
      coffeeCount: metric.coffeeInteractionIds.size,
      lastInteractionAt: metric.lastInteractionAt,
      daysSinceLastInteraction: metric.lastInteractionAt ? daysBetween(metric.lastInteractionAt, today) : null,
      networkingStatus: metric.networkingStatus
    }))
    .sort(compareObjectiveMetrics);
}

function compareObjectiveMetrics(left: ObjectiveMetricRow, right: ObjectiveMetricRow) {
  const priorityCompare = PRIORITY_RANK[left.priorityLevel] - PRIORITY_RANK[right.priorityLevel];
  if (priorityCompare) return priorityCompare;
  const typeCompare = TYPE_RANK[left.objectiveType] - TYPE_RANK[right.objectiveType];
  if (typeCompare) return typeCompare;
  const contactCompare = right.contactCount - left.contactCount;
  if (contactCompare) return contactCompare;
  return left.objectiveName.localeCompare(right.objectiveName, "es", { sensitivity: "base" });
}

function mostAdvancedStatus(current: string, candidate: string) {
  return statusRank(candidate) > statusRank(current) ? candidate : current;
}

function statusRank(status: string) {
  const index = NETWORKING_STATUS_ORDER.indexOf(status);
  return index >= 0 ? index + 1 : 0;
}

function daysBetween(value: string, today: Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

function dateValue(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function dateValueFromDate(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function isCoffeeInteraction(interaction: InteractionRow) {
  return interaction.interaction_type === "calendar" || interaction.interaction_type === "call";
}
