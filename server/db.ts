import { eq, desc, and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, engineConfigs, upvotes, exportJobs } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ============================================================
// Engine Configuration Queries
// ============================================================

export async function saveEngineConfig(userId: number, name: string, config: any, description?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db.insert(engineConfigs).values({
    userId,
    name,
    config,
    description: description || null,
  }).$returningId();

  return result;
}

export async function updateEngineConfig(id: number, userId: number, updates: { name?: string; config?: any; description?: string; isPublic?: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(engineConfigs)
    .set(updates)
    .where(and(eq(engineConfigs.id, id), eq(engineConfigs.userId, userId)));
}

export async function deleteEngineConfig(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(engineConfigs)
    .where(and(eq(engineConfigs.id, id), eq(engineConfigs.userId, userId)));
}

export async function getUserConfigs(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(engineConfigs)
    .where(eq(engineConfigs.userId, userId))
    .orderBy(desc(engineConfigs.updatedAt));
}

export async function getPublicConfigs(limit = 20, offset = 0) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const configs = await db.select({
    id: engineConfigs.id,
    userId: engineConfigs.userId,
    name: engineConfigs.name,
    description: engineConfigs.description,
    config: engineConfigs.config,
    createdAt: engineConfigs.createdAt,
    userName: users.name,
  })
    .from(engineConfigs)
    .leftJoin(users, eq(engineConfigs.userId, users.id))
    .where(eq(engineConfigs.isPublic, true))
    .orderBy(desc(engineConfigs.createdAt))
    .limit(limit)
    .offset(offset);

  // Get upvote counts
  const configIds = configs.map(c => c.id);
  if (configIds.length === 0) return [];

  const upvoteCounts = await db.select({
    configId: upvotes.configId,
    count: sql<number>`count(*)`.as('count'),
  })
    .from(upvotes)
    .where(sql`${upvotes.configId} IN (${sql.raw(configIds.join(','))})`)
    .groupBy(upvotes.configId);

  const countMap = new Map(upvoteCounts.map(u => [u.configId, u.count]));

  return configs.map(c => ({
    ...c,
    upvotes: countMap.get(c.id) || 0,
  }));
}

export async function getConfigById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.select().from(engineConfigs).where(eq(engineConfigs.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

// ============================================================
// Upvote Queries
// ============================================================

export async function toggleUpvote(userId: number, configId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db.select().from(upvotes)
    .where(and(eq(upvotes.userId, userId), eq(upvotes.configId, configId)))
    .limit(1);

  if (existing.length > 0) {
    await db.delete(upvotes)
      .where(and(eq(upvotes.userId, userId), eq(upvotes.configId, configId)));
    return false; // removed
  } else {
    await db.insert(upvotes).values({ userId, configId });
    return true; // added
  }
}

export async function getUserUpvotes(userId: number): Promise<number[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.select({ configId: upvotes.configId })
    .from(upvotes)
    .where(eq(upvotes.userId, userId));

  return result.map(r => r.configId);
}

// ============================================================
// Export Job Queries
// ============================================================

export async function createExportJob(userId: number, configId: number | null, format: 'wav' | 'mp3', duration: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db.insert(exportJobs).values({
    userId,
    configId,
    format,
    duration,
  }).$returningId();

  return result;
}

export async function updateExportJob(id: number, updates: { status?: string; fileUrl?: string; fileKey?: string; errorMessage?: string; completedAt?: Date }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(exportJobs).set(updates as any).where(eq(exportJobs.id, id));
}

export async function getUserExportJobs(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(exportJobs)
    .where(eq(exportJobs.userId, userId))
    .orderBy(desc(exportJobs.createdAt))
    .limit(10);
}

export async function getExportJobById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.select().from(exportJobs).where(eq(exportJobs.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function duplicateConfig(userId: number, configId: number, newName: string) {
  const original = await getConfigById(configId);
  if (!original) throw new Error("Config not found");

  return saveEngineConfig(userId, newName, original.config, original.description || undefined);
}
