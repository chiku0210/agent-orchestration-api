import { z } from "zod";

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .map((x) => {
        if (typeof x === "string") return x;
        if (x == null) return null;
        if (typeof x === "number" || typeof x === "boolean") return String(x);
        if (typeof x === "object") {
          const o = x as Record<string, unknown>;
          const pick =
            (typeof o.note === "string" && o.note) ||
            (typeof o.text === "string" && o.text) ||
            (typeof o.title === "string" && o.title) ||
            (typeof o.name === "string" && o.name) ||
            (typeof o.value === "string" && o.value) ||
            null;
          return pick ?? JSON.stringify(o);
        }
        return null;
      })
      .filter((s): s is string => Boolean(s && s.trim()));
  }
  if (typeof v === "string") return v.trim() ? [v] : [];
  return [];
}

function normalizeFileItem(item: unknown): unknown {
  if (!item || typeof item !== "object") return item;
  const o = item as Record<string, unknown>;

  // Fast-path: already correct
  if (typeof o.path === "string" && typeof o.content === "string") return o;

  const path =
    (typeof o.path === "string" && o.path) ||
    (typeof o.filename === "string" && o.filename) ||
    (typeof o.filePath === "string" && o.filePath) ||
    (typeof o.fileName === "string" && o.fileName) ||
    (typeof o.name === "string" && o.name) ||
    (typeof o.file === "string" && o.file) ||
    null;

  const content =
    (typeof o.content === "string" && o.content) ||
    (typeof o.code === "string" && o.code) ||
    (typeof o.source === "string" && o.source) ||
    (typeof o.body === "string" && o.body) ||
    (typeof o.text === "string" && o.text) ||
    (typeof o.fileContent === "string" && o.fileContent) ||
    (typeof o.contents === "string" && o.contents) ||
    (typeof o.data === "string" && o.data) ||
    null;

  if (path !== null || content !== null) {
    return {
      ...o,
      ...(path !== null ? { path } : {}),
      ...(content !== null ? { content } : {}),
    };
  }
  return o;
}

function normalizeFileBundleList(input: unknown): unknown {
  // Some models output wrapper objects like { fileBundle: { files: [...] } } or
  // just return the array directly. Normalize to { files: [...] }.
  const normalizeFileItems = (v: unknown): unknown[] | null => {
    if (Array.isArray(v)) return v.map(normalizeFileItem);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.path === "string" && typeof o.content === "string") return [o];
    }
    return null;
  };

  if (Array.isArray(input)) return { files: input };
  if (!input || typeof input !== "object") return input;
  const o = input as Record<string, unknown>;

  // Direct forms: { files: [...] } OR { files: {path,content} }
  const direct = normalizeFileItems(o.files);
  if (direct) return { files: direct };

  // Alternate keys
  const alternates = normalizeFileItems(o.file) ?? normalizeFileItems(o.generatedFiles) ?? normalizeFileItems(o.artifacts);
  if (alternates) return { files: alternates };

  // Wrapped forms: { fileBundle: { files: [...] } }, etc.
  const wrappers = [o.fileBundle, o.bundle, o.output, o.result, o.data];
  for (const w of wrappers) {
    if (w && typeof w === "object") {
      const wo = w as Record<string, unknown>;
      const wf = normalizeFileItems(wo.files);
      if (wf) return { files: wf };
    }
  }
  return input;
}

export const FileBundleListSchema = z.preprocess(
  (v) => normalizeFileBundleList(v),
  z.object({
    files: z
      .array(
        z.object({
          path: z.string(),
          content: z.string(),
        }),
      )
      .min(1),
  }),
);

export const SpecForgeHtmlOutputSchema = z.object({
  summary: z.string().min(1),
  html: z.string().min(1),
});

export const SpecForgePrdBlockSchema = z.preprocess(
  (input) => {
    if (!input || typeof input !== "object") return input;
    const o = input as Record<string, unknown>;
    return {
      ...o,
      problemStatement: o.problemStatement ?? o.problem_statement ?? o.statement ?? o.summary ?? "",
      users: o.users ?? o.target_users ?? o.audience ?? [],
      userStories: o.userStories ?? o.user_stories ?? o.stories ?? [],
      acceptanceCriteria: o.acceptanceCriteria ?? o.acceptance_criteria ?? o.criteria ?? [],
      outOfScope: o.outOfScope ?? o.out_of_scope ?? o.exclusions ?? [],
    };
  },
  z.object({
    problemStatement: z.string(),
    users: z.preprocess((v) => asStringArray(v), z.array(z.string())),
    userStories: z.preprocess((v) => asStringArray(v), z.array(z.string())),
    acceptanceCriteria: z.preprocess((v) => asStringArray(v), z.array(z.string())),
    outOfScope: z.preprocess((v) => asStringArray(v), z.array(z.string())),
  }),
);

function normalizeRiskItem(item: unknown): unknown {
  if (!item || typeof item !== "object") return item;
  const o = item as Record<string, unknown>;
  let category = typeof o.category === "string" ? o.category.toLowerCase() : null;
  if (category) {
    if (category.includes("security")) category = "security";
    else if (category.includes("privacy")) category = "privacy";
    else if (category.includes("reliab")) category = "reliability";
    else if (category.includes("abuse")) category = "abuse";
    else if (category.includes("complian")) category = "compliance";
  }
  return {
    ...o,
    ...(category ? { category } : {}),
  };
}

export const SpecForgeRiskListSchema = z.preprocess(
  (input) => {
    if (!input || typeof input !== "object") return input;
    const o = input as Record<string, unknown>;
    const risks = o.risks ?? o.risk_list ?? o.identified_risks ?? [];
    return {
      ...o,
      risks: Array.isArray(risks) ? risks.map(normalizeRiskItem) : [],
    };
  },
  z.object({
    risks: z.array(
      z.object({
        category: z.enum(["security", "privacy", "reliability", "abuse", "compliance"]),
        risk: z.string(),
        mitigation: z.string(),
      }),
    ),
  }),
);

function normalizeApiContract(item: unknown): unknown {
  if (!item || typeof item !== "object") return item;
  const o = item as Record<string, unknown>;

  const path = (typeof o.path === "string" && o.path) || (typeof o.route === "string" && o.route) || null;
  let method = typeof o.method === "string" ? o.method.toUpperCase() : null;
  const validMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  if (method && !validMethods.includes(method)) {
    method = null;
  }

  if (path !== null || method !== null) {
    return {
      ...o,
      ...(path !== null ? { path } : {}),
      ...(method !== null ? { method } : {}),
    };
  }
  return o;
}

export const SpecForgeArchitectureBlockSchema = z.preprocess(
  (input) => {
    if (!input || typeof input !== "object") return input;
    const o = input as Record<string, unknown>;
    return {
      ...o,
      overview: o.overview ?? o.summary ?? o.architecture_overview ?? "",
      apiContracts: o.apiContracts ?? o.api_contracts ?? o.routes ?? o.endpoints ?? [],
      dataModelNotes: o.dataModelNotes ?? o.data_model_notes ?? o.database_notes ?? [],
      fileStructure: o.fileStructure ?? o.file_structure ?? o.files ?? [],
    };
  },
  z.object({
    overview: z.string(),
    apiContracts: z.preprocess(
      (v) => (Array.isArray(v) ? v.map(normalizeApiContract) : v),
      z.array(
        z.object({
          method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
          path: z.string(),
          requestSchema: z.unknown(),
          responseSchema: z.unknown(),
        }),
      ),
    ),
    dataModelNotes: z.preprocess((v) => asStringArray(v), z.array(z.string())),
    fileStructure: z.array(
      z.object({
        path: z.string(),
        // Models occasionally omit `purpose`. Keep the run durable by coercing
        // missing/invalid values to a placeholder string, while still preferring
        // a real explanation when present.
        purpose: z.string().min(1).catch("TODO: describe purpose"),
      }),
    ),
  }),
);

export const SpecForgeDbBlockSchema = z.object({
  sqlMigrations: z.array(
    z.object({
      filename: z.string(),
      sql: z.string(),
    }),
  ),
  notes: z.array(z.string()),
});
