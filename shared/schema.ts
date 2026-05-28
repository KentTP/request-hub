import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const requests = sqliteTable("requests", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  person: text("person"),
  type: text("type").notNull().default("Task"), // Review | Proposal | Project | Task
  priority: text("priority").notNull().default("Normal"), // Urgent | High | Normal | Low
  status: text("status").notNull().default("inbox"), // inbox | in-progress | done
  deadline: text("deadline"), // ISO date string YYYY-MM-DD
  notes: text("notes").default(""),
  description: text("description").default(""),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

export const insertRequestSchema = createInsertSchema(requests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
});

export type InsertRequest = z.infer<typeof insertRequestSchema>;
export type Request = typeof requests.$inferSelect;
