import { z } from 'zod'

export const FACT_FIELDS = [
  'team',
  'fundingModel',
  'stage',
  'targetCustomer',
  'concern',
] as const

export type FactField = (typeof FACT_FIELDS)[number]

const missingQuestionSchema = z.object({
  field: z.enum(FACT_FIELDS),
  question: z.string().min(8).max(220),
})

export const extractResultSchema = z.object({
  extracted: z.object({
    team: z.string().optional(),
    fundingModel: z.string().optional(),
    stage: z.string().optional(),
    targetCustomer: z.string().optional(),
    concern: z.string().optional(),
  }),
  missing: z.array(missingQuestionSchema).max(5),
})

export type ParsedExtractResult = z.infer<typeof extractResultSchema>
