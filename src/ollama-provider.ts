import { Ollama } from 'ollama';
import { BaseEmbeddingProvider, EmbeddingConfig } from './embedding-provider.js';

export interface OllamaEmbeddingConfig extends EmbeddingConfig {
  host?: string;
  keepAlive?: string;
}

interface OllamaModelInfo {
  dimensions: number;
  contextWindow: number;
  description: string;
}

const OLLAMA_MODELS: Record<string, OllamaModelInfo> = {
  'mxbai-embed-large': {
    dimensions: 1024,
    contextWindow: 8192,
    description: 'High-precision embedding model for complex conversational context'
  },
  'nomic-embed-text': {
    dimensions: 768,
    contextWindow: 8192,
    description: 'Balanced performance embedding model for general-purpose use'
  },
  'all-minilm': {
    dimensions: 384,
    contextWindow: 512,
    description: 'Lightweight embedding model for fast inference'
  }
};

export class OllamaEmbeddingProvider extends BaseEmbeddingProvider {
  private ollama: Ollama;
  private modelInfo: OllamaModelInfo;
  private batchQueue: Array<{
    text: string;
    resolve: (embedding: number[]) => void;
    reject: (error: Error) => void;
  }> = [];
  private processingBatch = false;

  constructor(config: OllamaEmbeddingConfig) {
    super(config);
    
    this.ollama = new Ollama({
      host: config.host || 'http://localhost:11434'
    });

    this.modelInfo = OLLAMA_MODELS[config.model] || {
      dimensions: 1024,
      contextWindow: 8192,
      description: 'Unknown model'
    };
  }

  get name(): string {
    return `ollama:${this.config.model}`;
  }

  get dimensions(): number {
    return this.modelInfo.dimensions;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    // Check cache first
    const cached = this.getCachedEmbedding(text);
    if (cached) {
      return cached;
    }

    // Use batching for better performance
    if (this.config.batchSize && this.config.batchSize > 1) {
      return this.generateWithBatching(text);
    }

    // Generate directly
    const embedding = await this.retryWithBackoff(
      () => this.generateSingleEmbedding(text),
      this.config.maxRetries || 3
    );

    // Cache result
    this.setCachedEmbedding(text, embedding);
    return embedding;
  }

  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    const batchSize = this.config.batchSize || 32;
    const results: number[][] = [];

    // Process in batches
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchResults = await this.retryWithBackoff(
        () => this.generateBatchEmbeddingsInternal(batch),
        this.config.maxRetries || 3
      );
      results.push(...batchResults);
    }

    return results;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await Promise.race([
        this.ollama.embed({
          model: this.config.model,
          input: 'test'
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 5000)
        )
      ]);
      return true;
    } catch (error) {
      console.warn(`Ollama model ${this.config.model} not available:`, (error as Error).message);
      return false;
    }
  }

  private async generateSingleEmbedding(text: string): Promise<number[]> {
    const response = await Promise.race([
      this.ollama.embed({
        model: this.config.model,
        input: text,
        truncate: true,
        keep_alive: (this.config as OllamaEmbeddingConfig).keepAlive || '5m'
      }),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), this.config.timeoutMs || 30000)
      )
    ]);

    if (!response.embeddings || response.embeddings.length === 0) {
      throw new Error('No embeddings returned from Ollama');
    }

    return response.embeddings[0];
  }

  private async generateBatchEmbeddingsInternal(texts: string[]): Promise<number[][]> {
    const response = await Promise.race([
      this.ollama.embed({
        model: this.config.model,
        input: texts,
        truncate: true,
        keep_alive: (this.config as OllamaEmbeddingConfig).keepAlive || '10m'
      }),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Batch request timeout')), (this.config.timeoutMs || 30000) * 2)
      )
    ]);

    if (!response.embeddings || response.embeddings.length !== texts.length) {
      throw new Error(`Expected ${texts.length} embeddings, got ${response.embeddings?.length || 0}`);
    }

    return response.embeddings;
  }

  private async generateWithBatching(text: string): Promise<number[]> {
    return new Promise((resolve, reject) => {
      this.batchQueue.push({ text, resolve, reject });
      this.processBatch();
    });
  }

  private async processBatch(): Promise<void> {
    if (this.processingBatch || this.batchQueue.length === 0) {
      return;
    }

    // Wait a bit to collect more requests
    await this.sleep(50);
    
    if (this.batchQueue.length === 0) {
      return;
    }

    this.processingBatch = true;
    const batchSize = this.config.batchSize || 32;
    const currentBatch = this.batchQueue.splice(0, batchSize);

    try {
      const texts = currentBatch.map(item => item.text);
      const embeddings = await this.generateBatchEmbeddingsInternal(texts);

      // Resolve individual promises and cache results
      currentBatch.forEach((item, index) => {
        const embedding = embeddings[index];
        this.setCachedEmbedding(item.text, embedding);
        item.resolve(embedding);
      });
    } catch (error) {
      // Reject all pending requests in this batch
      currentBatch.forEach(item => item.reject(error as Error));
    } finally {
      this.processingBatch = false;

      // Process next batch if there are more items
      if (this.batchQueue.length > 0) {
        setTimeout(() => this.processBatch(), 100);
      }
    }
  }

  // Utility methods
  async pullModel(): Promise<void> {
    console.log(`Pulling Ollama model: ${this.config.model}`);
    try {
      await this.ollama.pull({ model: this.config.model });
      console.log(`Successfully pulled model: ${this.config.model}`);
    } catch (error) {
      throw new Error(`Failed to pull model ${this.config.model}: ${(error as Error).message}`);
    }
  }

  async getModelInfo(): Promise<any> {
    try {
      return await this.ollama.show({ model: this.config.model });
    } catch (error) {
      throw new Error(`Failed to get model info for ${this.config.model}: ${(error as Error).message}`);
    }
  }

  getModelMetadata(): OllamaModelInfo {
    return { ...this.modelInfo };
  }

  // Static factory methods
  static createHighPrecision(host?: string): OllamaEmbeddingProvider {
    return new OllamaEmbeddingProvider({
      provider: 'ollama',
      model: 'mxbai-embed-large',
      host,
      batchSize: 16,
      maxRetries: 3,
      timeoutMs: 30000,
      cacheEnabled: true,
      keepAlive: '15m'
    });
  }

  static createBalanced(host?: string): OllamaEmbeddingProvider {
    return new OllamaEmbeddingProvider({
      provider: 'ollama',
      model: 'nomic-embed-text',
      host,
      batchSize: 32,
      maxRetries: 3,
      timeoutMs: 20000,
      cacheEnabled: true,
      keepAlive: '10m'
    });
  }

  static createLightweight(host?: string): OllamaEmbeddingProvider {
    return new OllamaEmbeddingProvider({
      provider: 'ollama',
      model: 'all-minilm',
      host,
      batchSize: 64,
      maxRetries: 3,
      timeoutMs: 15000,
      cacheEnabled: true,
      keepAlive: '5m'
    });
  }
}