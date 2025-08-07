export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  
  generateEmbedding(text: string): Promise<number[]>;
  generateBatchEmbeddings(texts: string[]): Promise<number[][]>;
  isAvailable(): Promise<boolean>;
}

export interface EmbeddingConfig {
  provider: string;
  model: string;
  host?: string;
  batchSize?: number;
  maxRetries?: number;
  timeoutMs?: number;
  cacheEnabled?: boolean;
}

export interface EmbeddingCache {
  get(key: string): number[] | null;
  set(key: string, embedding: number[]): void;
  clear(): void;
  size(): number;
}

export class MemoryEmbeddingCache implements EmbeddingCache {
  private cache = new Map<string, { embedding: number[], timestamp: number }>();
  private maxSize: number;
  private ttl: number;

  constructor(maxSize: number = 1000, ttlMs: number = 3600000) { // 1 hour TTL
    this.maxSize = maxSize;
    this.ttl = ttlMs;
  }

  get(key: string): number[] | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return cached.embedding;
  }

  set(key: string, embedding: number[]): void {
    if (this.cache.size >= this.maxSize) {
      // Remove oldest entry
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      embedding,
      timestamp: Date.now()
    });
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

export abstract class BaseEmbeddingProvider implements EmbeddingProvider {
  protected config: EmbeddingConfig;
  protected cache: EmbeddingCache | null = null;

  constructor(config: EmbeddingConfig) {
    this.config = config;
    
    if (config.cacheEnabled) {
      this.cache = new MemoryEmbeddingCache();
    }
  }

  abstract get name(): string;
  abstract get dimensions(): number;
  abstract generateEmbedding(text: string): Promise<number[]>;
  abstract generateBatchEmbeddings(texts: string[]): Promise<number[][]>;
  abstract isAvailable(): Promise<boolean>;

  protected getCacheKey(text: string): string {
    return `${this.config.provider}:${this.config.model || 'default'}:${text}`;
  }

  protected getCachedEmbedding(text: string): number[] | null {
    if (!this.cache) return null;
    return this.cache.get(this.getCacheKey(text));
  }

  protected setCachedEmbedding(text: string, embedding: number[]): void {
    if (!this.cache) return;
    this.cache.set(this.getCacheKey(text), embedding);
  }

  protected async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  protected async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === maxRetries) {
          break;
        }

        const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), 10000);
        console.warn(`Embedding attempt ${attempt} failed, retrying in ${delay}ms:`, (error as Error).message);
        await this.sleep(delay);
      }
    }

    throw new Error(`Operation failed after ${maxRetries} attempts: ${lastError!.message}`);
  }
}