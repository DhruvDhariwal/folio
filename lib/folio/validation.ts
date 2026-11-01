import { z } from "zod";
export const field = z.object({
  value: z.string().max(200),
  sourceId: z.string().max(80).optional(),
  confirmed: z.boolean().optional(),
  derived: z.boolean().optional(),
});
const coord = z.number().finite().min(-10000).max(20000);
export const extractionSchema = z.object({
  fields: z.object({
    vendor: field,
    entity: field,
    reference: field,
    date: field,
    currency: field,
    po: field,
    net: field,
    tax: field,
    total: field,
    servicePeriod: field,
    fees: field,
    discount: field,
  }),
  lines: z
    .array(
      z.object({
        code: z.string().max(40),
        description: z.string().max(200),
        quantity: z.string().max(30),
        unitPrice: z.string().max(30),
        net: z.string().max(30),
        sourceId: z.string().max(80).optional(),
        confirmed: z.boolean().optional(),
      }),
    )
    .max(50),
  sources: z
    .array(
      z.object({
        id: z.string().max(80),
        page: z.number().int().min(1).max(5),
        text: z.string().max(500),
        box: z.tuple([coord, coord, coord, coord]),
      }),
    )
    .max(300),
  pages: z
    .array(
      z.object({
        width: z.number().positive().max(20000),
        height: z.number().positive().max(20000),
      }),
    )
    .min(1)
    .max(5),
  method: z.enum(["native", "ocr", "mixed"]),
  flags: z.array(z.string().max(200)).max(10),
  confirmedBy: z.string().optional(),
  confirmedAt: z.string().optional(),
});
const amount = z.number().int().nonnegative().max(1000000000000);
export const procurementSchema = z.object({
  vendors: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        name: z.string().min(1).max(150),
        aliases: z.array(z.string().max(150)).max(10),
        active: z.boolean(),
        currency: z.string().length(3),
      }),
    )
    .min(1)
    .max(100),
  pos: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        vendorId: z.string().max(40),
        entity: z.string().min(1).max(150),
        currency: z.enum(["USD", "INR"]),
        cap: amount,
        status: z.enum(["open", "closed"]),
        method: z.enum(["two_way", "three_way"]),
        project: z.string().max(150),
        lines: z
          .array(
            z.object({
              id: z.string().min(1).max(40),
              description: z.string().max(200),
              kind: z.enum(["amount_cap", "quantity", "milestone"]),
              cap: amount,
              quantity: z.string().max(30).optional(),
              unitPrice: amount.optional(),
              period: z.string().max(30).optional(),
            }),
          )
          .min(1)
          .max(50),
      }),
    )
    .min(1)
    .max(100),
  commitments: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        vendorId: z.string().max(40),
        entity: z.string().min(1).max(150),
        reference: z.string().min(1).max(100),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        currency: z.enum(["USD", "INR"]),
        net: amount,
        gross: amount,
        poId: z.string().max(40),
        lineId: z.string().max(40),
        period: z.string().max(30).optional(),
        quantity: z
          .string()
          .regex(/^\d+(?:\.\d{1,4})?$/)
          .optional(),
      }),
    )
    .max(300),
});
