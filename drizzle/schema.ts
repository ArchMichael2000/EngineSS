import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, json, bigint, boolean } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Engine configurations saved by users.
 * The `config` JSON column stores the full engine parameter set.
 */
export const engineConfigs = mysqlTable("engine_configs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  config: json("config").notNull(),
  isPublic: boolean("isPublic").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EngineConfig = typeof engineConfigs.$inferSelect;
export type InsertEngineConfig = typeof engineConfigs.$inferInsert;

/**
 * Community upvotes on public engine configs.
 */
export const upvotes = mysqlTable("upvotes", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  configId: int("configId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Upvote = typeof upvotes.$inferSelect;
export type InsertUpvote = typeof upvotes.$inferInsert;

/**
 * Export jobs for server-side audio rendering.
 */
export const exportJobs = mysqlTable("export_jobs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  configId: int("configId"),
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
  format: mysqlEnum("format", ["wav", "mp3"]).default("wav").notNull(),
  duration: int("duration").default(10).notNull(),
  fileUrl: text("fileUrl"),
  fileKey: text("fileKey"),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type ExportJob = typeof exportJobs.$inferSelect;
export type InsertExportJob = typeof exportJobs.$inferInsert;
