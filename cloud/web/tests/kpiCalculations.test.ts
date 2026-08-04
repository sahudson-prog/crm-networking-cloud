import test from "node:test";
import assert from "node:assert/strict";

import { buildDashboardKpis } from "../lib/kpiCalculations.ts";
import type { ContactRow, InteractionParticipantRow, InteractionRow, KpiTrend } from "../lib/readModel.ts";

function contact(overrides: Partial<ContactRow> & { id: string; display_name?: string }): ContactRow {
  const { id, display_name, ...rest } = overrides;
  return {
    id,
    display_name: display_name ?? id,
    company: "",
    role: "",
    networking_status: "Contactado",
    networking_focus: true,
    is_headhunter: false,
    headhunter_domains: [],
    is_active: true,
    updated_at: "2026-07-01T00:00:00Z",
    contact_emails: [],
    contact_phones: [],
    ...rest
  };
}

function interaction(overrides: Partial<InteractionRow> & { id: string; occurred_at: string }): InteractionRow {
  const { id, occurred_at, ...rest } = overrides;
  return {
    id,
    interaction_type: "email",
    direction: "unknown",
    occurred_at,
    subject: "",
    metadata: null,
    ...rest
  };
}

function participant(interaction_id: string, contact_id: string, role = "TO"): InteractionParticipantRow {
  return {
    interaction_id,
    contact_id,
    email_identity: null,
    role
  };
}

function trendByTitle(trends: KpiTrend[], title: string) {
  const trend = trends.find((item) => item.title === title);
  assert.ok(trend, `No existe KPI ${title}`);
  return trend;
}

function pointByLabel(trend: KpiTrend, label: string) {
  const point = trend.points.find((item) => item.label === label);
  assert.ok(point, `No existe periodo ${label} en ${trend.title}`);
  return point;
}

test("usa fecha calendario de origen, sin mover 01/04 al mes anterior por zona horaria", () => {
  const contacts = [contact({ id: "c-mar" }), contact({ id: "c-apr" })];
  const interactions = [
    interaction({ id: "email-mar", occurred_at: "2026-03-20T00:00:00+00:00" }),
    interaction({ id: "email-apr-boundary", occurred_at: "2026-04-01T00:00:00+00:00" }),
    interaction({ id: "coffee-apr-boundary", interaction_type: "calendar", occurred_at: "2026-04-01T00:00:00+00:00" })
  ];
  const participants = [
    participant("email-mar", "c-mar"),
    participant("email-apr-boundary", "c-apr")
  ];

  const trends = buildDashboardKpis({
    contacts,
    interactions,
    participants,
    mode: "monthly",
    networkingStartDate: new Date(2026, 2, 1),
    today: new Date(2026, 3, 15)
  });

  assert.equal(pointByLabel(trendByTitle(trends, "Contactos realizados"), "mar 26").total, 1);
  assert.equal(pointByLabel(trendByTitle(trends, "Contactos realizados"), "abr 26").total, 1);
  assert.equal(pointByLabel(trendByTitle(trends, "Total cafes"), "mar 26").total, 0);
  assert.equal(pointByLabel(trendByTitle(trends, "Total cafes"), "abr 26").total, 1);
});

test("contactos realizados cuenta personas distintas y separa primer contacto", () => {
  const contacts = [contact({ id: "c1" }), contact({ id: "c2" }), contact({ id: "inbound" })];
  const interactions = [
    interaction({ id: "c1-first", occurred_at: "2026-03-05T00:00:00+00:00" }),
    interaction({ id: "c1-repeat", occurred_at: "2026-03-06T00:00:00+00:00" }),
    interaction({ id: "c2-first", occurred_at: "2026-03-07T00:00:00+00:00" }),
    interaction({ id: "c1-next-month", occurred_at: "2026-04-02T00:00:00+00:00" }),
    interaction({ id: "incoming-email", direction: "inbound", occurred_at: "2026-04-03T00:00:00+00:00" })
  ];
  const participants = [
    participant("c1-first", "c1"),
    participant("c1-repeat", "c1"),
    participant("c2-first", "c2"),
    participant("c1-next-month", "c1"),
    participant("incoming-email", "inbound", "FROM")
  ];

  const contactos = trendByTitle(
    buildDashboardKpis({
      contacts,
      interactions,
      participants,
      mode: "monthly",
      networkingStartDate: new Date(2026, 2, 1),
      today: new Date(2026, 3, 15)
    }),
    "Contactos realizados"
  );

  assert.deepEqual(pointByLabel(contactos, "mar 26"), { label: "mar 26", total: 2, firstTime: 2 });
  assert.deepEqual(pointByLabel(contactos, "abr 26"), { label: "abr 26", total: 1, firstTime: 0 });
  assert.equal(contactos.accumulated, 2);
});

test("contactos HH realizados cuenta dominios distintos, no cantidad de contactos", () => {
  const contacts = [
    contact({
      id: "hh1",
      is_headhunter: true,
      headhunter_domains: ["@alpha.cl"],
      contact_emails: [{ email: "uno@alpha.cl", domain: "@alpha.cl" }]
    }),
    contact({
      id: "hh2",
      is_headhunter: true,
      headhunter_domains: ["@alpha.cl"],
      contact_emails: [{ email: "dos@alpha.cl", domain: "@alpha.cl" }]
    }),
    contact({
      id: "hh3",
      is_headhunter: true,
      headhunter_domains: ["@beta.cl"],
      contact_emails: [{ email: "tres@beta.cl", domain: "@beta.cl" }]
    }),
    contact({
      id: "no-hh",
      is_headhunter: false,
      headhunter_domains: ["@ignored.cl"],
      contact_emails: [{ email: "cuatro@ignored.cl", domain: "@ignored.cl" }]
    })
  ];
  const interactions = [
    interaction({ id: "to-hh1", occurred_at: "2026-04-02T00:00:00+00:00" }),
    interaction({ id: "to-hh2", occurred_at: "2026-04-03T00:00:00+00:00" }),
    interaction({ id: "to-hh3", occurred_at: "2026-04-04T00:00:00+00:00" }),
    interaction({ id: "to-no-hh", occurred_at: "2026-04-05T00:00:00+00:00" })
  ];
  const participants = [
    participant("to-hh1", "hh1"),
    participant("to-hh2", "hh2"),
    participant("to-hh3", "hh3"),
    participant("to-no-hh", "no-hh")
  ];

  const hh = trendByTitle(
    buildDashboardKpis({
      contacts,
      interactions,
      participants,
      mode: "monthly",
      networkingStartDate: new Date(2026, 3, 1),
      today: new Date(2026, 3, 30)
    }),
    "Contactos HH realizados"
  );

  assert.deepEqual(pointByLabel(hh, "abr 26"), { label: "abr 26", total: 2, firstTime: 2 });
  assert.equal(hh.accumulated, 2);
});

test("periodos respetan inicio de networking y maximo de 12 puntos", () => {
  const trends = buildDashboardKpis({
    contacts: [],
    interactions: [],
    participants: [],
    mode: "monthly",
    networkingStartDate: new Date(2025, 0, 1),
    today: new Date(2026, 6, 28)
  });

  const contactos = trendByTitle(trends, "Contactos realizados");
  assert.equal(contactos.points.length, 12);
  assert.equal(contactos.points[0]?.label, "ago 25");
  assert.equal(contactos.points.at(-1)?.label, "jul 26");
});
