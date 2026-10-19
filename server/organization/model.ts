import { z } from 'zod';
export const departmentSchema = z.object({
  id: z.string(),
  title: z.string(),
  parentId: z.string().nullable(),
  active: z.boolean(),
  version: z.number(),
});
export const departmentInput = departmentSchema
  .omit({ id: true })
  .extend({
    title: z.string().trim().min(1).max(100),
    version: z.number().int().min(0),
    parentId: z.string().min(1).max(100).nullable(),
  })
  .strict();
export const memberInput = z
  .object({
    userId: z.string().min(1).max(100),
    active: z.boolean(),
    primary: z.boolean(),
  })
  .strict();
export const projectInput = z
  .object({
    projectId: z.string().min(1).max(100),
    subjectType: z.enum(['user', 'org.department']),
    subjectId: z.string().min(1).max(100),
    active: z.boolean(),
    version: z.number().int().min(0),
  })
  .strict();
export type Department = z.infer<typeof departmentSchema>;
export interface Member {
  id: string;
  departmentId: string;
  userId: string;
  active: boolean;
  primary: boolean;
}
export interface ProjectAccess {
  id: string;
  projectId: string;
  subjectType: string;
  subjectId: string;
  active: boolean;
  version: number;
}
export const SETTINGS = 'hyl.organization';
