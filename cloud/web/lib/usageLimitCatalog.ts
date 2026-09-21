export type UsageResetWindow = "minute" | "day" | "month" | "none";
export type UsageCapacityVariable = "active_users";

export type UsageCapacityContext = {
  activeUsers: number;
};

export type UsageLimitDefinition = {
  appDefault: number;
  appUnit: string;
  description: string;
  id: string;
  impactRank: number;
  impactSummary: string;
  observedDefault?: number;
  observedNote?: string;
  observedSource?: string;
  provider: string;
  providerDefault: number;
  providerUnit: string;
  resetWindow: UsageResetWindow;
  scaleBy?: UsageCapacityVariable;
  settingKind?: "quota" | "run_limit";
  title: string;
};

export const USAGE_LIMIT_DEFINITIONS: UsageLimitDefinition[] = [
  {
    appDefault: 100,
    appUnit: "requests/min",
    description: "Seguro interno para lecturas de Google Calendar por usuario.",
    id: "google_calendar_requests_per_minute_user",
    impactRank: 10,
    impactSummary: "Bajo impacto: se libera minuto a minuto.",
    provider: "Google Calendar",
    providerDefault: 600,
    providerUnit: "requests/min por usuario",
    resetWindow: "minute",
    scaleBy: "active_users",
    settingKind: "quota",
    title: "Calendar por minuto"
  },
  {
    appDefault: 2500,
    appUnit: "eventos/revision",
    description: "Tope de citas que la app intentara revisar en una corrida historica de Calendar.",
    id: "google_calendar_events_per_review",
    impactRank: 45,
    impactSummary: "Impacto alto en pruebas: si queda bajo, la revision historica corta antes de llegar a citas utiles.",
    provider: "Google Calendar",
    providerDefault: 2500,
    providerUnit: "eventos por pagina",
    resetWindow: "minute",
    settingKind: "run_limit",
    title: "Citas por revision"
  },
  {
    appDefault: 2,
    appUnit: "paginas/revision",
    description: "Cantidad maxima de paginas Calendar que la app leera en una corrida.",
    id: "google_calendar_pages_per_review",
    impactRank: 43,
    impactSummary: "Impacto medio: subirlo ayuda si una pagina no alcanza, pero aumenta llamadas a Google.",
    provider: "Google Calendar",
    providerDefault: 10,
    providerUnit: "tope interno beta",
    resetWindow: "minute",
    settingKind: "run_limit",
    title: "Paginas Calendar"
  },
  {
    appDefault: 20000,
    appUnit: "requests/dia",
    description: "Seguro diario para reconstrucciones y revisiones de calendario.",
    id: "google_calendar_requests_per_day_project",
    impactRank: 40,
    impactSummary: "Impacto medio: limita reconstrucciones durante la ventana diaria.",
    provider: "Google Calendar",
    providerDefault: 1000000,
    providerUnit: "requests/dia por proyecto",
    resetWindow: "day",
    settingKind: "quota",
    title: "Calendar diario"
  },
  {
    appDefault: 3000,
    appUnit: "unidades/min",
    description: "Seguro interno para llamadas Gmail, incluyendo busqueda y lectura de mensajes.",
    id: "gmail_quota_units_per_minute_user",
    impactRank: 20,
    impactSummary: "Bajo impacto: se libera minuto a minuto, pero puede frenar acciones visibles.",
    provider: "Gmail",
    providerDefault: 6000,
    providerUnit: "unidades/min por usuario",
    resetWindow: "minute",
    scaleBy: "active_users",
    settingKind: "quota",
    title: "Gmail por minuto"
  },
  {
    appDefault: 250,
    appUnit: "correos/revision",
    description: "Tope de correos que la app intentara leer completos en una corrida historica de Gmail.",
    id: "gmail_messages_per_review",
    impactRank: 48,
    impactSummary: "Impacto alto en pruebas: cada correo leido completo consume unidades Gmail.",
    provider: "Gmail",
    providerDefault: 500,
    providerUnit: "mensajes por pagina",
    resetWindow: "minute",
    settingKind: "run_limit",
    title: "Correos por revision"
  },
  {
    appDefault: 3,
    appUnit: "paginas/revision",
    description: "Cantidad maxima de paginas Gmail que la app leera en una corrida.",
    id: "gmail_pages_per_review",
    impactRank: 46,
    impactSummary: "Impacto medio: subirlo amplia cobertura, pero puede leer mas correos completos.",
    provider: "Gmail",
    providerDefault: 10,
    providerUnit: "tope interno beta",
    resetWindow: "minute",
    settingKind: "run_limit",
    title: "Paginas Gmail"
  },
  {
    appDefault: 1000000,
    appUnit: "unidades/dia",
    description: "Seguro diario bajo el umbral de facturacion de Gmail.",
    id: "gmail_quota_units_per_day_project",
    impactRank: 50,
    impactSummary: "Impacto alto: si se agota, bloquea actividad de Gmail por el resto del dia.",
    provider: "Gmail",
    providerDefault: 80000000,
    providerUnit: "unidades/dia por proyecto",
    resetWindow: "day",
    settingKind: "quota",
    title: "Gmail diario"
  },
  {
    appDefault: 20,
    appUnit: "paginas/revision",
    description: "Cantidad maxima de paginas Google Contacts que la app leera en una revision.",
    id: "google_contacts_pages_per_review",
    impactRank: 44,
    impactSummary: "Impacto medio-alto: si queda bajo, una carga inicial podria traer solo una parte de los contactos.",
    provider: "Google Contacts",
    providerDefault: 20,
    providerUnit: "tope interno beta",
    resetWindow: "minute",
    settingKind: "run_limit",
    title: "Paginas Contacts"
  },
  {
    appDefault: 350,
    appUnit: "MB",
    description: "Meta interna para no acercarse al limite de base Supabase Free.",
    id: "supabase_database_size_mb",
    impactRank: 70,
    impactSummary: "Impacto maximo: no se libera solo; exige borrar datos o subir plan.",
    observedDefault: 34.2,
    observedNote: "Pantallazo Supabase Usage: Max database size 34.2 MB.",
    observedSource: "Supabase Usage Summary 2026-08-13",
    provider: "Supabase",
    providerDefault: 500,
    providerUnit: "MB de base",
    resetWindow: "none",
    settingKind: "quota",
    title: "Base de datos"
  },
  {
    appDefault: 3000,
    appUnit: "MB/mes",
    description: "Meta interna para transferencia de datos desde Supabase hacia la app.",
    id: "supabase_egress_mb_month",
    impactRank: 65,
    impactSummary: "Impacto alto: se libera al cambiar el mes o al subir capacidad.",
    observedDefault: 132,
    observedNote: "Pantallazo Supabase Usage: 0.132 GB usados en el periodo.",
    observedSource: "Supabase Usage Summary 2026-08-13",
    provider: "Supabase",
    providerDefault: 5000,
    providerUnit: "MB/mes",
    resetWindow: "month",
    settingKind: "quota",
    title: "Egress Supabase"
  },
  {
    appDefault: 250000,
    appUnit: "invocaciones/mes",
    description: "Meta interna para futuras funciones server-side si movemos sync al backend.",
    id: "supabase_edge_function_invocations_month",
    impactRank: 60,
    impactSummary: "Impacto alto: puede detener automatizaciones hasta el siguiente mes.",
    observedDefault: 0,
    observedNote: "Pantallazo Supabase Usage: sin invocaciones en el periodo.",
    observedSource: "Supabase Usage Summary 2026-08-13",
    provider: "Supabase",
    providerDefault: 500000,
    providerUnit: "invocaciones/mes",
    resetWindow: "month",
    settingKind: "quota",
    title: "Edge Functions"
  },
  {
    appDefault: 3500,
    appUnit: "MB/mes",
    description: "Egress servido desde cache. Hoy no lo usamos, pero conviene verlo separado porque Supabase lo factura como cuota distinta.",
    id: "supabase_cached_egress_mb_month",
    impactRank: 62,
    impactSummary: "Impacto alto: se libera al cambiar el mes o al subir capacidad.",
    observedDefault: 0,
    observedNote: "Pantallazo Supabase Usage: 0 GB usados en el periodo.",
    observedSource: "Supabase Usage Summary 2026-08-13",
    provider: "Supabase",
    providerDefault: 5000,
    providerUnit: "MB/mes",
    resetWindow: "month",
    settingKind: "quota",
    title: "Cached egress"
  },
  {
    appDefault: 700,
    appUnit: "MB",
    description: "Espacio usado por buckets de Storage. Hoy esta en cero; queda visible para no olvidar adjuntos o respaldos futuros.",
    id: "supabase_storage_size_mb",
    impactRank: 58,
    impactSummary: "Impacto alto: no se libera solo; exige borrar archivos o subir plan.",
    observedDefault: 0,
    observedNote: "Pantallazo Supabase Usage: 0 GB usados en el periodo.",
    observedSource: "Supabase Usage Summary 2026-08-13",
    provider: "Supabase",
    providerDefault: 1024,
    providerUnit: "MB de storage",
    resetWindow: "none",
    settingKind: "quota",
    title: "Storage"
  },
  {
    appDefault: 10000,
    appUnit: "MAU/mes",
    description: "Usuarios activos mensuales de Supabase Auth. Importa cuando pasemos de beta personal a mas usuarios.",
    id: "supabase_monthly_active_users",
    impactRank: 57,
    impactSummary: "Impacto medio-alto: se libera en el siguiente ciclo de facturacion.",
    observedDefault: 2,
    observedNote: "Pantallazo Supabase Usage: 2 usuarios activos mensuales.",
    observedSource: "Supabase Usage Summary 2026-08-13",
    provider: "Supabase",
    providerDefault: 50000,
    providerUnit: "MAU/mes",
    resetWindow: "month",
    settingKind: "quota",
    title: "Usuarios activos"
  },
  {
    appDefault: 1000000,
    appUnit: "mensajes/mes",
    description: "Mensajes Realtime. Hoy no usamos Realtime, pero quedara relevante si agregamos presencia o actualizaciones en vivo.",
    id: "supabase_realtime_messages_month",
    impactRank: 35,
    impactSummary: "Impacto medio: no afecta el MVP actual mientras no usemos Realtime.",
    observedDefault: 0,
    observedNote: "Pantallazo Supabase Usage: 0 mensajes en el periodo.",
    observedSource: "Supabase Usage Summary 2026-08-13",
    provider: "Supabase",
    providerDefault: 2000000,
    providerUnit: "mensajes/mes",
    resetWindow: "month",
    settingKind: "quota",
    title: "Realtime mensajes"
  },
  {
    appDefault: 100,
    appUnit: "conexiones peak",
    description: "Peak de conexiones concurrentes Realtime. Hoy no usamos Realtime, pero queda como indicador de crecimiento futuro.",
    id: "supabase_realtime_concurrent_connections",
    impactRank: 30,
    impactSummary: "Impacto medio-bajo: no afecta el MVP actual mientras no usemos Realtime.",
    observedDefault: 0,
    observedNote: "Pantallazo Supabase Usage: 0 conexiones peak en el periodo.",
    observedSource: "Supabase Usage Summary 2026-08-13",
    provider: "Supabase",
    providerDefault: 200,
    providerUnit: "conexiones peak",
    resetWindow: "month",
    settingKind: "quota",
    title: "Realtime conexiones"
  }
];

export function resetWindowLabel(value: UsageResetWindow) {
  if (value === "minute") return "Ventana movil de 60 segundos";
  if (value === "day") return "Ventana movil de 24 horas";
  if (value === "month") return "Mes calendario";
  return "No se resetea automaticamente";
}

export function usageLimitDefinitionsByImpact() {
  return [...USAGE_LIMIT_DEFINITIONS].sort((left, right) => right.impactRank - left.impactRank);
}

export function effectiveProviderLimit(definition: UsageLimitDefinition, providerBase: number, capacity: UsageCapacityContext) {
  if (definition.scaleBy === "active_users") {
    return providerBase * Math.max(1, capacity.activeUsers);
  }
  return providerBase;
}

export function scaleDescription(definition: UsageLimitDefinition, capacity: UsageCapacityContext) {
  if (definition.scaleBy === "active_users") {
    return `Indicador agregado ajustado por ${Math.max(1, capacity.activeUsers)} usuario(s) considerado(s).`;
  }
  return "Indicador fijo: no depende directamente de la cantidad de usuarios.";
}
