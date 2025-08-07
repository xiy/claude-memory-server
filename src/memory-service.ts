import { MemoryDatabase, Memory } from './database.js';
import { randomUUID } from 'crypto';
import { EmbeddingProvider } from './embedding-provider.js';
import { OllamaEmbeddingProvider } from './ollama-provider.js';
import { SemanticSearchService, SemanticSearchResult, HybridSearchResult } from './semantic-search.js';

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

export interface MemoryServiceConfig {
  dbPath?: string;
  enableEmbeddings?: boolean;
  embeddingProvider?: EmbeddingProvider;
  ollamaHost?: string;
}

export class MemoryService {
  private db: MemoryDatabase;
  private embeddingProvider?: EmbeddingProvider;
  private semanticSearchService?: SemanticSearchService;
  private config: MemoryServiceConfig;

  constructor(config: MemoryServiceConfig = {}) {
    this.config = config;
    this.db = new MemoryDatabase(config.dbPath);
    
    if (config.enableEmbeddings) {
      this.initializeEmbeddings();
    }
  }

  private async initializeEmbeddings() {
    try {
      if (this.config.embeddingProvider) {
        this.embeddingProvider = this.config.embeddingProvider;
      } else {
        // Default to Ollama with balanced model
        this.embeddingProvider = OllamaEmbeddingProvider.createBalanced(this.config.ollamaHost);
      }

      // Check if the embedding provider is available
      const isAvailable = await this.embeddingProvider.isAvailable();
      if (!isAvailable) {
        console.warn('Embedding provider not available, semantic search disabled');
        this.embeddingProvider = undefined;
        return;
      }

      this.semanticSearchService = new SemanticSearchService(this.db, this.embeddingProvider);
      console.log(`Semantic search initialized with ${this.embeddingProvider.name}`);

      // Generate embeddings for existing memories without them
      await this.generateMissingEmbeddings();
    } catch (error) {
      console.error('Failed to initialize embeddings:', error);
      this.embeddingProvider = undefined;
      this.semanticSearchService = undefined;
    }
  }

  private async generateMissingEmbeddings() {
    if (!this.semanticSearchService) return;

    try {
      const allMemories = this.db.getRecentMemories(1000); // Get up to 1000 recent memories
      await this.semanticSearchService.ensureEmbeddingsExist(allMemories);
    } catch (error) {
      console.error('Failed to generate missing embeddings:', error);
    }
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

    // Generate embedding if semantic search is enabled
    if (this.semanticSearchService) {
      try {
        await this.semanticSearchService.generateAndStoreEmbedding(memory);
      } catch (error) {
        console.warn(`Failed to generate embedding for new memory ${id}:`, error);
      }
    }

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

    // Regenerate embedding if content was updated and semantic search is enabled
    if (input.content && this.semanticSearchService) {
      try {
        await this.semanticSearchService.generateAndStoreEmbedding(updatedMemory);
      } catch (error) {
        console.warn(`Failed to regenerate embedding for updated memory ${id}:`, error);
      }
    }

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

  // Semantic search methods
  async semanticSearch(
    query: string,
    options: { limit?: number; minSimilarity?: number; category?: string } = {}
  ): Promise<SemanticSearchResult[]> {
    if (!this.semanticSearchService) {
      throw new Error('Semantic search not available. Embeddings are disabled.');
    }

    return this.semanticSearchService.searchSimilar(query, options);
  }

  async hybridSearch(
    query: string,
    options: { 
      limit?: number; 
      minSimilarity?: number; 
      category?: string;
      textWeight?: number;
      semanticWeight?: number;
    } = {}
  ): Promise<HybridSearchResult[]> {
    if (!this.semanticSearchService) {
      // Fall back to regular text search if semantic search is not available
      const textResults = await this.searchMemories({ query, category: options.category, limit: options.limit });
      return textResults.map(memory => ({
        memory: memory as any,
        similarity: 0,
        textScore: 1,
        combinedScore: 1,
        embedding: []
      }));
    }

    return this.semanticSearchService.hybridSearch(query, options);
  }

  async findSimilarMemories(
    memoryId: string,
    options: { limit?: number; minSimilarity?: number; category?: string } = {}
  ): Promise<SemanticSearchResult[]> {
    if (!this.semanticSearchService) {
      throw new Error('Semantic search not available. Embeddings are disabled.');
    }

    return this.semanticSearchService.findSimilarToMemory(memoryId, options);
  }

  async clusterMemories(
    threshold: number = 0.8,
    minClusterSize: number = 2
  ): Promise<Array<{ cluster: SemanticSearchResult[]; avgSimilarity: number }>> {
    if (!this.semanticSearchService) {
      throw new Error('Semantic search not available. Embeddings are disabled.');
    }

    return this.semanticSearchService.clusterMemories(threshold, minClusterSize);
  }

  // Configuration and status methods
  isSemanticSearchEnabled(): boolean {
    return this.semanticSearchService !== undefined;
  }

  getEmbeddingProviderInfo(): { name: string; dimensions: number } | null {
    if (!this.embeddingProvider) return null;
    
    return {
      name: this.embeddingProvider.name,
      dimensions: this.embeddingProvider.dimensions
    };
  }

  async getEmbeddingStatistics(): Promise<{
    totalEmbeddings: number;
    providerStats: Record<string, { count: number; models: string[] }>;
    dimensionsDistribution: Record<number, number>;
  } | null> {
    if (!this.semanticSearchService) return null;

    return this.semanticSearchService.getEmbeddingStatistics();
  }

  async generateMissingEmbeddingsManually(): Promise<number> {
    if (!this.semanticSearchService) {
      throw new Error('Semantic search not available. Embeddings are disabled.');
    }

    const allMemories = this.db.getRecentMemories(10000);
    const missingBefore = allMemories.filter(memory => {
      const existing = this.db.getEmbedding(
        memory.id,
        this.embeddingProvider!.name.split(':')[0],
        this.embeddingProvider!.name.split(':')[1]
      );
      return !existing;
    }).length;

    await this.semanticSearchService.ensureEmbeddingsExist(allMemories);
    
    return missingBefore;
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