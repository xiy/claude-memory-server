import { MemoryDatabase, Memory } from './database.js';
import { randomUUID } from 'crypto';

export interface CreateMemoryInput {
  content: string;
  category: string;
  metadata?: Record<string, any>;
  relevance_score?: number;
}

export interface UpdateMemoryInput {
  content?: string;
  category?: string;
  metadata?: Record<string, any>;
  relevance_score?: number;
}

export interface SearchMemoryInput {
  query: string;
  category?: string;
  limit?: number;
}

export interface MemorySearchResult extends Memory {
  metadata_parsed: Record<string, any>;
}

export class MemoryService {
  private db: MemoryDatabase;

  constructor(dbPath?: string) {
    this.db = new MemoryDatabase(dbPath);
  }

  // Store a new memory
  async storeMemory(input: CreateMemoryInput): Promise<MemorySearchResult> {
    const id = randomUUID();
    const memory = this.db.createMemory(
      id,
      input.content,
      input.category,
      input.metadata || {},
      input.relevance_score || 1.0
    );

    return this.parseMemoryMetadata(memory);
  }

  // Retrieve a specific memory by ID
  async getMemory(id: string): Promise<MemorySearchResult | null> {
    const memory = this.db.getMemory(id);
    if (!memory) return null;

    return this.parseMemoryMetadata(memory);
  }

  // Update an existing memory
  async updateMemory(id: string, input: UpdateMemoryInput): Promise<MemorySearchResult | null> {
    // Convert metadata to string if it's an object
    const dbInput = { ...input };
    if (input.metadata && typeof input.metadata === 'object') {
      (dbInput as any).metadata = JSON.stringify(input.metadata);
    }
    
    const updatedMemory = this.db.updateMemory(id, dbInput);
    if (!updatedMemory) return null;

    return this.parseMemoryMetadata(updatedMemory);
  }

  // Delete a memory
  async deleteMemory(id: string): Promise<boolean> {
    return this.db.deleteMemory(id);
  }

  // Search memories using full-text search
  async searchMemories(input: SearchMemoryInput): Promise<MemorySearchResult[]> {
    let memories: Memory[];

    if (input.category) {
      // If category is specified, first get memories by category then filter by search query
      const categoryMemories = this.db.getMemoriesByCategory(input.category, input.limit || 50);
      memories = categoryMemories.filter(memory => 
        memory.content.toLowerCase().includes(input.query.toLowerCase()) ||
        memory.category.toLowerCase().includes(input.query.toLowerCase())
      ).slice(0, input.limit || 10);
    } else {
      // Use full-text search
      memories = this.db.searchMemories(input.query, input.limit || 10);
    }

    return memories.map(memory => this.parseMemoryMetadata(memory));
  }

  // Get memories by category
  async getMemoriesByCategory(category: string, limit: number = 10): Promise<MemorySearchResult[]> {
    const memories = this.db.getMemoriesByCategory(category, limit);
    return memories.map(memory => this.parseMemoryMetadata(memory));
  }

  // Get recent memories
  async getRecentMemories(limit: number = 10): Promise<MemorySearchResult[]> {
    const memories = this.db.getRecentMemories(limit);
    return memories.map(memory => this.parseMemoryMetadata(memory));
  }

  // Get all available categories
  async getCategories(): Promise<string[]> {
    return this.db.getCategories();
  }

  // Get memory statistics
  async getMemoryStats(): Promise<Record<string, number>> {
    return this.db.getMemoryStats();
  }

  // Helper method to parse metadata JSON
  private parseMemoryMetadata(memory: Memory): MemorySearchResult {
    let metadata_parsed: Record<string, any> = {};
    
    try {
      metadata_parsed = JSON.parse(memory.metadata);
    } catch (error) {
      console.warn(`Failed to parse metadata for memory ${memory.id}:`, error);
      metadata_parsed = {};
    }

    return {
      ...memory,
      metadata_parsed
    };
  }

  // Close database connection
  close() {
    this.db.close();
  }
}

// Predefined categories for organizing memories
export const MEMORY_CATEGORIES = {
  FACTS: 'facts',
  PREFERENCES: 'preferences',
  CONVERSATIONS: 'conversations',
  PROJECTS: 'projects',
  LEARNING: 'learning',
  GOALS: 'goals',
  CONTEXT: 'context',
  REMINDERS: 'reminders'
} as const;

export type MemoryCategory = typeof MEMORY_CATEGORIES[keyof typeof MEMORY_CATEGORIES];