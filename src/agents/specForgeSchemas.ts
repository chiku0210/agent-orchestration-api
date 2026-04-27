import { z } from "zod";

export const FileBundleListSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      content: z.string(),
    }),
  ),
});

export const SpecForgePrdBlockSchema = z.object({
  problemStatement: z.string(),
  users: z.array(z.string()),
  userStories: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  outOfScope: z.array(z.string()),
});

export const SpecForgeRiskListSchema = z.object({
  risks: z.array(
    z.object({
      category: z.enum(["security", "privacy", "reliability", "abuse", "compliance"]),
      risk: z.string(),
      mitigation: z.string(),
    }),
  ),
});

export const SpecForgeArchitectureBlockSchema = z.object({
  overview: z.string(),
  apiContracts: z.array(
    z.object({
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      path: z.string(),
      requestSchema: z.unknown(),
      responseSchema: z.unknown(),
    }),
  ),
  dataModelNotes: z.array(z.string()),
  fileStructure: z.array(
    z.object({
      path: z.string(),
      // Models occasionally omit `purpose`. Keep the run durable by coercing
      // missing/invalid values to a placeholder string, while still preferring
      // a real explanation when present.
      purpose: z.string().min(1).catch("TODO: describe purpose"),
    }),
  ),
});

export const SpecForgeDbBlockSchema = z.object({
  sqlMigrations: z.array(
    z.object({
      filename: z.string(),
      sql: z.string(),
    }),
  ),
  notes: z.array(z.string()),
});
