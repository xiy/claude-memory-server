import Database from 'better-sqlite3';
import { join } from 'path';

export interface Memory {
  id: string;
  content: string;
  category: string;
  metadata: string; // JSON string
  embedding?: Buffer; // Vector embedding for similarity search
  created_at: number;
  updated_at: number;
  relevance_score: number;
}

export class MemoryDatabase {
  private db: Database.Database;

  constructor(dbPath?: string) {
    this.db = new Database(dbPath || join(process.cwd(), 'memory.db'));
    this.initializeSchema();
  }

  private initializeSchema() {
    // Create memories table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        category TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        embedding BLOB,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        relevance_score REAL DEFAULT 1.0
      );
    `);

    // Create indexes for better query performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
      CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
      CREATE INDEX IF NOT EXISTS idx_memories_relevance ON memories(relevance_score);
    `);

    // Create FTS table for full-text search
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        id UNINDEXED,
        content,
        category,
        content=memories,
        content_rowid=rowid
      );
    `);

    // Create triggers to keep FTS table in sync
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, id, content, category) 
        VALUES (new.rowid, new.id, new.content, new.category);
      END;
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, id, content, category) 
        VALUES('delete', old.rowid, old.id, old.content, old.category);
      END;
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, id, content, category) 
        VALUES('delete', old.rowid, old.id, old.content, old.category);
        INSERT INTO memories_fts(rowid, id, content, category) 
        VALUES (new.rowid, new.id, new.content, new.category);
      END;
    `);
  }

  // Create a new memory
  createMemory(
    id: string,
    content: string,
    category: string,
    metadata: Record<string, any> = {},
    relevanceScore: number = 1.0
  ): Memory {
    const now = Date.now();
    const memory: Memory = {
      id,
      content,
      category,
      metadata: JSON.stringify(metadata),
      created_at: now,
      updated_at: now,
      relevance_score: relevanceScore
    };

    const stmt = this.db.prepare(`
      INSERT INTO memories (id, content, category, metadata, created_at, updated_at, relevance_score)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(memory.id, memory.content, memory.category, memory.metadata, 
             memory.created_at, memory.updated_at, memory.relevance_score);
    
    return memory;
  }

  // Get memory by ID
  getMemory(id: string): Memory | null {
    const stmt = this.db.prepare('SELECT * FROM memories WHERE id = ?');
    const result = stmt.get(id) as Memory | undefined;
    return result || null;
  }

  // Update existing memory
  updateMemory(
    id: string, 
    updates: Partial<Pick<Memory, 'content' | 'category' | 'relevance_score'>> & { metadata?: string | Record<string, any> }
  ): Memory | null {
    const existing = this.getMemory(id);
    if (!existing) return null;

    const updatedMemory = {
      ...existing,
      ...updates,
      updated_at: Date.now()
    };

    if (updates.metadata && typeof updates.metadata === 'object') {
      updatedMemory.metadata = JSON.stringify(updates.metadata);
    }

    const stmt = this.db.prepare(`
      UPDATE memories 
      SET content = ?, category = ?, metadata = ?, updated_at = ?, relevance_score = ?
      WHERE id = ?
    `);
    
    stmt.run(
      updatedMemory.content,
      updatedMemory.category,
      updatedMemory.metadata,
      updatedMemory.updated_at,
      updatedMemory.relevance_score,
      id
    );
    
    return {
      ...updatedMemory,
      metadata: updatedMemory.metadata
    } as Memory;
  }

  // Delete memory
  deleteMemory(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM memories WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // Full-text search
  searchMemories(query: string, limit: number = 10): Memory[] {
    const stmt = this.db.prepare(`
      SELECT m.* FROM memories m
      JOIN memories_fts fts ON m.rowid = fts.rowid
      WHERE memories_fts MATCH ?
      ORDER BY rank, m.relevance_score DESC, m.updated_at DESC
      LIMIT ?
    `);
    
    return stmt.all(query, limit) as Memory[];
  }

  // Get memories by category
  getMemoriesByCategory(category: string, limit: number = 10): Memory[] {
    const stmt = this.db.prepare(`
      SELECT * FROM memories 
      WHERE category = ? 
      ORDER BY relevance_score DESC, updated_at DESC 
      LIMIT ?
    `);
    
    return stmt.all(category, limit) as Memory[];
  }

  // Get recent memories
  getRecentMemories(limit: number = 10): Memory[] {
    const stmt = this.db.prepare(`
      SELECT * FROM memories 
      ORDER BY updated_at DESC 
      LIMIT ?
    `);
    
    return stmt.all(limit) as Memory[];
  }

  // Get all categories
  getCategories(): string[] {
    const stmt = this.db.prepare(`
      SELECT DISTINCT category FROM memories 
      ORDER BY category
    `);
    
    return stmt.all().map((row: any) => row.category);
  }

  // Get memory count by category
  getMemoryStats(): Record<string, number> {
    const stmt = this.db.prepare(`
      SELECT category, COUNT(*) as count 
      FROM memories 
      GROUP BY category
    `);
    
    const results = stmt.all() as Array<{ category: string; count: number }>;
    return Object.fromEntries(results.map(r => [r.category, r.count]));
  }

  close() {
    this.db.close();
  }
}