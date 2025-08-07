import similarity from 'cos-similarity';
import { MemoryDatabase, Memory } from './database.js';
import { EmbeddingProvider } from './embedding-provider.js';

export interface SemanticSearchResult {
  memory: Memory;
  similarity: number;
  embedding: number[];
}

export interface SemanticSearchOptions {
  limit?: number;
  minSimilarity?: number;
  category?: string;
  includeEmbeddings?: boolean;
}

export interface HybridSearchOptions extends SemanticSearchOptions {
  textWeight?: number;
  semanticWeight?: number;
  boostRecentMemories?: boolean;
}

export interface HybridSearchResult extends SemanticSearchResult {
  textScore?: number;
  combinedScore: number;
}

export class SemanticSearchService {
  constructor(
    private db: MemoryDatabase,
    private embeddingProvider: EmbeddingProvider
  ) {}

  async searchSimilar(
    query: string,
    options: SemanticSearchOptions = {}
  ): Promise<SemanticSearchResult[]> {
    const {
      limit = 10,
      minSimilarity = 0.7,
      category,
      includeEmbeddings = false
    } = options;

    // Generate query embedding
    const queryEmbedding = await this.embeddingProvider.generateEmbedding(query);

    // Get all memories with embeddings
    const memoriesWithEmbeddings = this.db.getMemoriesWithEmbeddings(
      this.embeddingProvider.name.split(':')[0],
      this.embeddingProvider.name.split(':')[1]
    );

    // Filter by category if specified
    let filteredMemories = memoriesWithEmbeddings;
    if (category) {
      filteredMemories = memoriesWithEmbeddings.filter(
        item => item.memory.category === category
      );
    }

    // Calculate similarities
    const results: SemanticSearchResult[] = filteredMemories
      .map(item => ({
        memory: item.memory,
        similarity: similarity(queryEmbedding, item.embedding),
        embedding: includeEmbeddings ? item.embedding : []
      }))
      .filter(result => result.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return results;
  }

  async hybridSearch(
    query: string,
    options: HybridSearchOptions = {}
  ): Promise<HybridSearchResult[]> {
    const {
      limit = 10,
      minSimilarity = 0.5,
      category,
      textWeight = 0.3,
      semanticWeight = 0.7,
      boostRecentMemories = true,
      includeEmbeddings = false
    } = options;

    // Get semantic search results
    const semanticResults = await this.searchSimilar(query, {
      limit: limit * 2, // Get more candidates for hybrid ranking
      minSimilarity: minSimilarity * 0.8, // Lower threshold for semantic
      category,
      includeEmbeddings
    });

    // Get full-text search results
    const textResults = this.db.searchMemories(query, limit * 2);

    // Create score maps
    const semanticScoreMap = new Map<string, number>();
    semanticResults.forEach(result => {
      semanticScoreMap.set(result.memory.id, result.similarity);
    });

    const textScoreMap = new Map<string, number>();
    textResults.forEach((memory, index) => {
      // Convert rank to normalized score (higher rank = lower index = higher score)
      const normalizedScore = Math.max(0, (textResults.length - index) / textResults.length);
      textScoreMap.set(memory.id, normalizedScore);
    });

    // Combine all unique memories
    const allMemoryIds = new Set([
      ...semanticResults.map(r => r.memory.id),
      ...textResults.map(r => r.id)
    ]);

    const hybridResults: HybridSearchResult[] = Array.from(allMemoryIds)
      .map(memoryId => {
        const semanticResult = semanticResults.find(r => r.memory.id === memoryId);
        const textMemory = textResults.find(r => r.id === memoryId);
        
        const memory = semanticResult?.memory || textMemory!;
        const semanticScore = semanticScoreMap.get(memoryId) || 0;
        const textScore = textScoreMap.get(memoryId) || 0;

        let combinedScore = semanticScore * semanticWeight + textScore * textWeight;

        // Boost recent memories if enabled
        if (boostRecentMemories) {
          const daysSinceUpdate = (Date.now() - memory.updated_at) / (1000 * 60 * 60 * 24);
          const recencyBoost = Math.max(0, 1 - daysSinceUpdate / 30); // Boost diminishes over 30 days
          combinedScore += recencyBoost * 0.1;
        }

        return {
          memory,
          similarity: semanticScore,
          textScore,
          combinedScore,
          embedding: includeEmbeddings ? (semanticResult?.embedding || []) : []
        };
      })
      .filter(result => result.combinedScore > 0.1) // Minimum combined threshold
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, limit);

    return hybridResults;
  }

  async findSimilarToMemory(
    memoryId: string,
    options: SemanticSearchOptions = {}
  ): Promise<SemanticSearchResult[]> {
    const { limit = 5, minSimilarity = 0.7, category } = options;

    // Get the embedding for the source memory
    const sourceEmbedding = this.db.getEmbedding(
      memoryId,
      this.embeddingProvider.name.split(':')[0],
      this.embeddingProvider.name.split(':')[1]
    );

    if (!sourceEmbedding) {
      throw new Error(`No embedding found for memory ${memoryId}`);
    }

    // Get all memories with embeddings (excluding the source memory)
    const memoriesWithEmbeddings = this.db.getMemoriesWithEmbeddings(
      this.embeddingProvider.name.split(':')[0],
      this.embeddingProvider.name.split(':')[1]
    ).filter(item => item.memory.id !== memoryId);

    // Filter by category if specified
    let filteredMemories = memoriesWithEmbeddings;
    if (category) {
      filteredMemories = memoriesWithEmbeddings.filter(
        item => item.memory.category === category
      );
    }

    // Calculate similarities
    const results: SemanticSearchResult[] = filteredMemories
      .map(item => ({
        memory: item.memory,
        similarity: similarity(sourceEmbedding, item.embedding),
        embedding: item.embedding
      }))
      .filter(result => result.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return results;
  }

  async generateAndStoreEmbedding(memory: Memory): Promise<void> {
    try {
      const embedding = await this.embeddingProvider.generateEmbedding(memory.content);
      
      this.db.storeEmbedding(
        memory.id,
        embedding,
        this.embeddingProvider.name.split(':')[0], // provider
        this.embeddingProvider.name.split(':')[1], // model
        this.embeddingProvider.dimensions
      );
    } catch (error) {
      console.error(`Failed to generate embedding for memory ${memory.id}:`, error);
      throw error;
    }
  }

  async ensureEmbeddingsExist(memories: Memory[]): Promise<void> {
    const missingEmbeddings: Memory[] = [];

    // Check which memories are missing embeddings
    for (const memory of memories) {
      const existing = this.db.getEmbedding(
        memory.id,
        this.embeddingProvider.name.split(':')[0],
        this.embeddingProvider.name.split(':')[1]
      );

      if (!existing) {
        missingEmbeddings.push(memory);
      }
    }

    if (missingEmbeddings.length === 0) {
      return;
    }

    console.log(`Generating ${missingEmbeddings.length} missing embeddings...`);

    // Generate embeddings in batches
    const batchSize = 32;
    for (let i = 0; i < missingEmbeddings.length; i += batchSize) {
      const batch = missingEmbeddings.slice(i, i + batchSize);
      const texts = batch.map(memory => memory.content);

      try {
        const embeddings = await this.embeddingProvider.generateBatchEmbeddings(texts);

        // Store each embedding
        batch.forEach((memory, index) => {
          this.db.storeEmbedding(
            memory.id,
            embeddings[index],
            this.embeddingProvider.name.split(':')[0],
            this.embeddingProvider.name.split(':')[1],
            this.embeddingProvider.dimensions
          );
        });

        console.log(`Generated embeddings for batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(missingEmbeddings.length / batchSize)}`);
      } catch (error) {
        console.error(`Failed to generate batch embeddings:`, error);
        
        // Fall back to individual generation
        for (const memory of batch) {
          try {
            await this.generateAndStoreEmbedding(memory);
          } catch (individualError) {
            console.error(`Failed to generate embedding for memory ${memory.id}:`, individualError);
          }
        }
      }
    }

    console.log(`Completed generating ${missingEmbeddings.length} embeddings`);
  }

  // Clustering and analysis methods
  async clusterMemories(
    threshold: number = 0.8,
    minClusterSize: number = 2
  ): Promise<Array<{ cluster: SemanticSearchResult[]; avgSimilarity: number }>> {
    const memoriesWithEmbeddings = this.db.getMemoriesWithEmbeddings(
      this.embeddingProvider.name.split(':')[0],
      this.embeddingProvider.name.split(':')[1]
    );

    const clusters: Array<{ cluster: SemanticSearchResult[]; avgSimilarity: number }> = [];
    const processed = new Set<string>();

    for (const item of memoriesWithEmbeddings) {
      if (processed.has(item.memory.id)) continue;

      const cluster: SemanticSearchResult[] = [{
        memory: item.memory,
        similarity: 1.0,
        embedding: item.embedding
      }];

      let totalSimilarity = 1.0;

      // Find similar memories for this cluster
      for (const other of memoriesWithEmbeddings) {
        if (other.memory.id === item.memory.id || processed.has(other.memory.id)) {
          continue;
        }

        const sim = similarity(item.embedding, other.embedding);
        if (sim >= threshold) {
          cluster.push({
            memory: other.memory,
            similarity: sim,
            embedding: other.embedding
          });
          totalSimilarity += sim;
          processed.add(other.memory.id);
        }
      }

      if (cluster.length >= minClusterSize) {
        clusters.push({
          cluster,
          avgSimilarity: totalSimilarity / cluster.length
        });
      }

      processed.add(item.memory.id);
    }

    return clusters.sort((a, b) => b.avgSimilarity - a.avgSimilarity);
  }

  async getEmbeddingStatistics(): Promise<{
    totalEmbeddings: number;
    providerStats: Record<string, { count: number; models: string[] }>;
    dimensionsDistribution: Record<number, number>;
  }> {
    const providerStats = this.db.getEmbeddingStats();
    const totalEmbeddings = Object.values(providerStats)
      .reduce((sum, stats) => sum + stats.count, 0);

    // Get dimensions distribution (simplified for now)
    const dimensionsDistribution: Record<number, number> = {
      [this.embeddingProvider.dimensions]: totalEmbeddings
    };

    return {
      totalEmbeddings,
      providerStats,
      dimensionsDistribution
    };
  }
}