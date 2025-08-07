import Database from 'better-sqlite3';
import { join } from 'path';

export interface Memory {
  id: string;
  content: string;
  category: string;
  metadata: string; // JSON string
  created_at: number;
  updated_at: number;
  relevance_score: number;
}

export interface MemoryEmbedding {
  memory_id: string;
  embedding: Buffer;
  provider: string;
  model: string;
  dimensions: number;
  created_at: number;
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
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        relevance_score REAL DEFAULT 1.0
      );
    `);

    // Create embeddings table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_embeddings (
        memory_id TEXT NOT NULL,
        embedding BLOB NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (memory_id, provider, model),
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );
    `);

    // Create indexes for better query performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
      CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
      CREATE INDEX IF NOT EXISTS idx_memories_relevance ON memories(relevance_score);
      CREATE INDEX IF NOT EXISTS idx_embeddings_provider_model ON memory_embeddings(provider, model);
      CREATE INDEX IF NOT EXISTS idx_embeddings_memory_id ON memory_embeddings(memory_id);
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

  // Embedding operations
  storeEmbedding(
    memoryId: string,
    embedding: number[],
    provider: string,
    model: string,
    dimensions: number
  ): void {
    const embeddingBuffer = this.serializeEmbedding(embedding);
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO memory_embeddings 
      (memory_id, embedding, provider, model, dimensions, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(memoryId, embeddingBuffer, provider, model, dimensions, Date.now());
  }

  getEmbedding(memoryId: string, provider: string, model: string): number[] | null {
    const stmt = this.db.prepare(`
      SELECT embedding FROM memory_embeddings 
      WHERE memory_id = ? AND provider = ? AND model = ?
    `);
    const result = stmt.get(memoryId, provider, model) as { embedding: Buffer } | undefined;
    
    if (!result) return null;
    return this.deserializeEmbedding(result.embedding);
  }

  getAllEmbeddings(provider: string, model: string): Array<{ memoryId: string; embedding: number[] }> {
    const stmt = this.db.prepare(`
      SELECT memory_id, embedding FROM memory_embeddings 
      WHERE provider = ? AND model = ?
    `);
    const results = stmt.all(provider, model) as Array<{ memory_id: string; embedding: Buffer }>;
    
    return results.map(row => ({
      memoryId: row.memory_id,
      embedding: this.deserializeEmbedding(row.embedding)
    }));
  }

  deleteEmbeddings(memoryId: string): void {
    const stmt = this.db.prepare('DELETE FROM memory_embeddings WHERE memory_id = ?');
    stmt.run(memoryId);
  }

  // Get memories with their embeddings for similarity search
  getMemoriesWithEmbeddings(
    provider: string, 
    model: string, 
    limit?: number
  ): Array<{ memory: Memory; embedding: number[] }> {
    let query = `
      SELECT 
        m.id, m.content, m.category, m.metadata, m.created_at, m.updated_at, m.relevance_score,
        e.embedding
      FROM memories m
      JOIN memory_embeddings e ON m.id = e.memory_id
      WHERE e.provider = ? AND e.model = ?
      ORDER BY m.updated_at DESC
    `;
    
    if (limit) {
      query += ' LIMIT ?';
    }

    const stmt = this.db.prepare(query);
    const results = stmt.all(provider, model, ...(limit ? [limit] : [])) as Array<{
      id: string;
      content: string;
      category: string;
      metadata: string;
      created_at: number;
      updated_at: number;
      relevance_score: number;
      embedding: Buffer;
    }>;

    return results.map(row => ({
      memory: {
        id: row.id,
        content: row.content,
        category: row.category,
        metadata: row.metadata,
        created_at: row.created_at,
        updated_at: row.updated_at,
        relevance_score: row.relevance_score
      },
      embedding: this.deserializeEmbedding(row.embedding)
    }));
  }

  // Utility methods for embedding serialization
  private serializeEmbedding(embedding: number[]): Buffer {
    const buffer = Buffer.allocUnsafe(embedding.length * 4);
    for (let i = 0; i < embedding.length; i++) {
      buffer.writeFloatLE(embedding[i], i * 4);
    }
    return buffer;
  }

  private deserializeEmbedding(buffer: Buffer): number[] {
    const embedding: number[] = [];
    for (let i = 0; i < buffer.length; i += 4) {
      embedding.push(buffer.readFloatLE(i));
    }
    return embedding;
  }

  // Get embedding statistics
  getEmbeddingStats(): Record<string, { count: number; models: string[] }> {
    const stmt = this.db.prepare(`
      SELECT provider, model, COUNT(*) as count 
      FROM memory_embeddings 
      GROUP BY provider, model
    `);
    const results = stmt.all() as Array<{ provider: string; model: string; count: number }>;
    
    const stats: Record<string, { count: number; models: string[] }> = {};
    
    results.forEach(row => {
      if (!stats[row.provider]) {
        stats[row.provider] = { count: 0, models: [] };
      }
      stats[row.provider].count += row.count;
      stats[row.provider].models.push(row.model);
    });
    
    return stats;
  }

  close() {
    this.db.close();
  }
}