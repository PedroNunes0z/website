import { z } from "zod";

const optionalUrl = z
  .string()
  .trim()
  .refine((value) => value === "" || URL.canParse(value), "Informe uma URL válida.");

export const articleSchema = z.object({
  id: z.string().trim().optional(),
  title: z.string().trim().min(5).max(120),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use apenas letras minúsculas, números e hífens."),
  excerpt: z.string().trim().min(20).max(240),
  content: z.string().trim().min(40),
  coverImage: optionalUrl,
  tags: z.array(z.string().trim().min(1).max(30)).max(6),
  status: z.enum(["draft", "published"]),
  featured: z.boolean(),
  publishedAt: z.string().datetime(),
});

export type ArticlePayload = z.infer<typeof articleSchema>;
