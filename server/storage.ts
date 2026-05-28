import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { requests } from "@shared/schema";
import type { InsertRequest, Request } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

const sqlite = new Database("data.db");
const db = drizzle(sqlite);

// Create table if not exists
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    person TEXT,
    type TEXT NOT NULL DEFAULT 'Task',
    priority TEXT NOT NULL DEFAULT 'Normal',
    status TEXT NOT NULL DEFAULT 'inbox',
    deadline TEXT,
    notes TEXT DEFAULT '',
    description TEXT DEFAULT '',
    created_at INTEGER,
    updated_at INTEGER,
    completed_at INTEGER
  )
`);

export interface IStorage {
  getAllRequests(): Request[];
  createRequest(data: InsertRequest): Request;
  updateRequest(id: string, data: Partial<InsertRequest & { completedAt: Date | null }>): Request | undefined;
  deleteRequest(id: string): boolean;
}

export class Storage implements IStorage {
  getAllRequests(): Request[] {
    return db.select().from(requests).orderBy(desc(requests.createdAt)).all();
  }

  createRequest(data: InsertRequest): Request {
    const now = new Date();
    const id = crypto.randomUUID();
    return db.insert(requests).values({
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
    }).returning().get();
  }

  updateRequest(id: string, data: Partial<InsertRequest & { completedAt: Date | null }>): Request | undefined {
    const now = new Date();
    return db.update(requests)
      .set({ ...data, updatedAt: now })
      .where(eq(requests.id, id))
      .returning()
      .get();
  }

  deleteRequest(id: string): boolean {
    const result = db.delete(requests).where(eq(requests.id, id)).run();
    return result.changes > 0;
  }
}

export const storage = new Storage();
