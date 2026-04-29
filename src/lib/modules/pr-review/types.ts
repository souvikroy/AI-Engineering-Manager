import { z } from "zod";

export const PRClassificationSchema = z.enum([
  "bug",
  "feature",
  "refactor",
  "migration",
  "security",
  "experiment",
  "infra",
  "docs",
  "test",
  "chore",
  "perf",
  "revert",
]);
export type PRClassification = z.infer<typeof PRClassificationSchema>;

export const FindingStatusSchema = z.enum(["pass", "fail", "na"]);
export const FindingSeveritySchema = z.enum(["blocking", "warning", "nit", "info"]);

export const FindingSchema = z.object({
  ruleId: z.string().regex(/^R\d+\.\d+$/),
  status: FindingStatusSchema,
  severity: FindingSeveritySchema,
  evidence: z.string().max(800),
});
export type Finding = z.infer<typeof FindingSchema>;

export const VerdictSchema = z.enum(["BLOCK", "REQUEST_CHANGES", "APPROVE_WITH_NITS", "APPROVE", "INSUFFICIENT_INFO"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const WorkflowResultSchema = z.object({
  workflowId: z.number().int().min(1).max(21),
  workflowTitle: z.string(),
  findings: z.array(FindingSchema),
});
export type WorkflowResult = z.infer<typeof WorkflowResultSchema>;

export const ReviewSchema = z.object({
  classification: PRClassificationSchema,
  workflowsRun: z.array(z.number().int()),
  results: z.array(WorkflowResultSchema),
  verdict: VerdictSchema,
  summary: z.string(),
});
export type Review = z.infer<typeof ReviewSchema>;
