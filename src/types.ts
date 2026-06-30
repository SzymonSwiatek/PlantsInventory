import type { Database } from "@/db/database.types";

/**
 * Domain DTOs — the stable, named surface the slices import from.
 * Row / Insert / Update aliases are derived from the generated Supabase types
 * (`src/db/database.types.ts`) so they stay in lockstep with the schema; never
 * reach into the generated file directly from feature code.
 */

type Tables = Database["public"]["Tables"];

// Entity (Row) shapes
export type Location = Tables["locations"]["Row"];
export type Plant = Tables["plants"]["Row"];
export type CareEvent = Tables["care_events"]["Row"];

// Insert shapes (defaults/auto columns optional)
export type LocationInsert = Tables["locations"]["Insert"];
export type PlantInsert = Tables["plants"]["Insert"];
export type CareEventInsert = Tables["care_events"]["Insert"];

// Update shapes (all columns optional)
export type LocationUpdate = Tables["locations"]["Update"];
export type PlantUpdate = Tables["plants"]["Update"];
export type CareEventUpdate = Tables["care_events"]["Update"];

// Care-event kind enum union ('water' | 'winterize')
export type CareEventKind = Database["public"]["Enums"]["care_event_kind"];

/** Plant due for watering — used by the /today page and its React island. */
export interface TodayPlant {
  id: string;
  name: string;
  locationName: string;
  daysOverdue: number;
}

/** Plant due for winterization — used by the /today page and its React island. */
export interface TodayWinterPlant {
  id: string;
  name: string;
  locationName: string;
  cutoff: string;
}

/**
 * Shape of the original AI suggestion snapshot stored in `plants.ai_suggestion`.
 * Write-once by convention (set on create by S-01, never overwritten by edits);
 * retained verbatim for the FR-015 "original suggestion" view and the acceptance
 * metric. All fields nullable — the provider may omit any of them.
 */
export interface AiSuggestion {
  species: string | null;
  description: string | null;
  sunlight: string | null;
  watering_interval_days: number | null;
  winterization_cutoff: string | null;
}

// ── AI chat / disease diagnosis ───────────────────────────────────────────────

export type DiagnosisRole = "user" | "model";

export interface DiagnosisMessage {
  role: DiagnosisRole;
  content: string;
}

export type DiagnosisResponse = { status: "ok"; reply: string } | { status: "ai_unavailable" };
