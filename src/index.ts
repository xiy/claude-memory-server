#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema, 
  Tool 
} from '@modelcontextprotocol/sdk/types.js';
import { MemoryService, MEMORY_CATEGORIES, MemoryServiceConfig } from './memory-service.js';

class MemoryServer {
  private server: Server;
  private memoryService: MemoryService;

  constructor() {
    this.server = new Server(
      {
        name: 'claude-memory-server',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    // Initialize memory service with embeddings enabled
    const config: MemoryServiceConfig = {
      enableEmbeddings: true,
      ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434'
    };
    
    this.memoryService = new MemoryService(config);
    this.setupTools();
    this.setupErrorHandling();
  }

  private setupTools() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'store_memory',
            description: 'Store a new memory entry for long-term context retention',
            inputSchema: {
              type: 'object',
              properties: {
                content: {
                  type: 'string',
                  description: 'The memory content to store'
                },
                category: {
                  type: 'string',
                  description: 'Category for organizing memories',
                  enum: Object.values(MEMORY_CATEGORIES)
                },
                metadata: {
                  type: 'object',
                  description: 'Additional metadata as key-value pairs',
                  additionalProperties: true
                },
                relevance_score: {
                  type: 'number',
                  description: 'Relevance score (0.0 to 1.0, default 1.0)',
                  minimum: 0,
                  maximum: 1
                }
              },
              required: ['content', 'category']
            }
          } as Tool,
          {
            name: 'search_memory',
            description: 'Search through stored memories using full-text search',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query to find relevant memories'
                },
                category: {
                  type: 'string',
                  description: 'Optional category to filter search results',
                  enum: Object.values(MEMORY_CATEGORIES)
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return (default 10)',
                  minimum: 1,
                  maximum: 50
                }
              },
              required: ['query']
            }
          } as Tool,
          {
            name: 'get_memory',
            description: 'Retrieve a specific memory by its ID',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'The unique ID of the memory to retrieve'
                }
              },
              required: ['id']
            }
          } as Tool,
          {
            name: 'update_memory',
            description: 'Update an existing memory entry',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'The unique ID of the memory to update'
                },
                content: {
                  type: 'string',
                  description: 'New content for the memory'
                },
                category: {
                  type: 'string',
                  description: 'New category for the memory',
                  enum: Object.values(MEMORY_CATEGORIES)
                },
                metadata: {
                  type: 'object',
                  description: 'New metadata as key-value pairs',
                  additionalProperties: true
                },
                relevance_score: {
                  type: 'number',
                  description: 'New relevance score (0.0 to 1.0)',
                  minimum: 0,
                  maximum: 1
                }
              },
              required: ['id']
            }
          } as Tool,
          {
            name: 'delete_memory',
            description: 'Delete a memory entry by its ID',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'The unique ID of the memory to delete'
                }
              },
              required: ['id']
            }
          } as Tool,
          {
            name: 'list_memories',
            description: 'List memories by category or get recent memories',
            inputSchema: {
              type: 'object',
              properties: {
                category: {
                  type: 'string',
                  description: 'Category to filter memories by',
                  enum: Object.values(MEMORY_CATEGORIES)
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of memories to return (default 10)',
                  minimum: 1,
                  maximum: 50
                },
                recent: {
                  type: 'boolean',
                  description: 'If true, return recent memories regardless of category'
                }
              }
            }
          } as Tool,
          {
            name: 'get_memory_stats',
            description: 'Get statistics about stored memories including categories and counts',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false
            }
          } as Tool,
          {
            name: 'semantic_search_memory',
            description: 'Search memories using semantic similarity (requires Ollama)',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query for semantic similarity matching'
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results (default 5)',
                  minimum: 1,
                  maximum: 20
                },
                min_similarity: {
                  type: 'number',
                  description: 'Minimum similarity score (0.0-1.0, default 0.7)',
                  minimum: 0,
                  maximum: 1
                },
                category: {
                  type: 'string',
                  description: 'Optional category filter',
                  enum: Object.values(MEMORY_CATEGORIES)
                }
              },
              required: ['query']
            }
          } as Tool,
          {
            name: 'hybrid_search_memory',
            description: 'Search memories using both text and semantic similarity',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query for hybrid text+semantic matching'
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results (default 10)',
                  minimum: 1,
                  maximum: 50
                },
                category: {
                  type: 'string',
                  description: 'Optional category filter',
                  enum: Object.values(MEMORY_CATEGORIES)
                },
                text_weight: {
                  type: 'number',
                  description: 'Weight for text search (default 0.3)',
                  minimum: 0,
                  maximum: 1
                },
                semantic_weight: {
                  type: 'number',
                  description: 'Weight for semantic search (default 0.7)',
                  minimum: 0,
                  maximum: 1
                }
              },
              required: ['query']
            }
          } as Tool,
          {
            name: 'find_similar_memories',
            description: 'Find memories similar to a specific memory',
            inputSchema: {
              type: 'object',
              properties: {
                memory_id: {
                  type: 'string',
                  description: 'ID of the memory to find similar ones for'
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results (default 5)',
                  minimum: 1,
                  maximum: 20
                },
                min_similarity: {
                  type: 'number',
                  description: 'Minimum similarity score (default 0.7)',
                  minimum: 0,
                  maximum: 1
                },
                category: {
                  type: 'string',
                  description: 'Optional category filter',
                  enum: Object.values(MEMORY_CATEGORIES)
                }
              },
              required: ['memory_id']
            }
          } as Tool,
          {
            name: 'get_embedding_stats',
            description: 'Get statistics about stored embeddings and semantic search status',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false
            }
          } as Tool
        ]
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (!args) {
        return {
          content: [{
            type: 'text',
            text: `Error: No arguments provided for tool "${name}"`
          }],
          isError: true
        };
      }

      try {
        switch (name) {
          case 'store_memory': {
            const result = await this.memoryService.storeMemory({
              content: args.content as string,
              category: args.category as string,
              metadata: args.metadata as Record<string, any> | undefined,
              relevance_score: args.relevance_score as number | undefined
            });
            return {
              content: [{
                type: 'text',
                text: `Memory stored successfully with ID: ${result.id}\n\nContent: ${result.content}\nCategory: ${result.category}\nCreated: ${new Date(result.created_at).toISOString()}`
              }]
            };
          }

          case 'search_memory': {
            const results = await this.memoryService.searchMemories({
              query: args.query as string,
              category: args.category as string | undefined,
              limit: args.limit as number | undefined
            });
            
            if (results.length === 0) {
              return {
                content: [{
                  type: 'text',
                  text: `No memories found for query: "${args.query}"`
                }]
              };
            }

            const formattedResults = results.map(memory => 
              `ID: ${memory.id}\nContent: ${memory.content}\nCategory: ${memory.category}\nRelevance: ${memory.relevance_score}\nUpdated: ${new Date(memory.updated_at).toISOString()}\nMetadata: ${JSON.stringify(memory.metadata_parsed, null, 2)}`
            ).join('\n\n---\n\n');

            return {
              content: [{
                type: 'text',
                text: `Found ${results.length} matching memories:\n\n${formattedResults}`
              }]
            };
          }

          case 'get_memory': {
            const memory = await this.memoryService.getMemory(args.id as string);
            
            if (!memory) {
              return {
                content: [{
                  type: 'text',
                  text: `Memory with ID "${args.id}" not found.`
                }]
              };
            }

            return {
              content: [{
                type: 'text',
                text: `Memory Details:\nID: ${memory.id}\nContent: ${memory.content}\nCategory: ${memory.category}\nRelevance: ${memory.relevance_score}\nCreated: ${new Date(memory.created_at).toISOString()}\nUpdated: ${new Date(memory.updated_at).toISOString()}\nMetadata: ${JSON.stringify(memory.metadata_parsed, null, 2)}`
              }]
            };
          }

          case 'update_memory': {
            const { id, ...updates } = args as any;
            const result = await this.memoryService.updateMemory(id, updates);
            
            if (!result) {
              return {
                content: [{
                  type: 'text',
                  text: `Memory with ID "${id}" not found.`
                }]
              };
            }

            return {
              content: [{
                type: 'text',
                text: `Memory updated successfully:\nID: ${result.id}\nContent: ${result.content}\nCategory: ${result.category}\nUpdated: ${new Date(result.updated_at).toISOString()}`
              }]
            };
          }

          case 'delete_memory': {
            const success = await this.memoryService.deleteMemory(args.id as string);
            
            return {
              content: [{
                type: 'text',
                text: success 
                  ? `Memory with ID "${args.id}" deleted successfully.`
                  : `Memory with ID "${args.id}" not found.`
              }]
            };
          }

          case 'list_memories': {
            let memories;
            
            if (args.recent) {
              memories = await this.memoryService.getRecentMemories((args.limit as number) || 10);
            } else if (args.category) {
              memories = await this.memoryService.getMemoriesByCategory(args.category as string, (args.limit as number) || 10);
            } else {
              memories = await this.memoryService.getRecentMemories((args.limit as number) || 10);
            }

            if (memories.length === 0) {
              return {
                content: [{
                  type: 'text',
                  text: 'No memories found.'
                }]
              };
            }

            const formattedMemories = memories.map(memory => 
              `ID: ${memory.id}\nContent: ${memory.content.slice(0, 100)}${memory.content.length > 100 ? '...' : ''}\nCategory: ${memory.category}\nUpdated: ${new Date(memory.updated_at).toISOString()}`
            ).join('\n\n---\n\n');

            return {
              content: [{
                type: 'text',
                text: `Found ${memories.length} memories:\n\n${formattedMemories}`
              }]
            };
          }

          case 'get_memory_stats': {
            const stats = await this.memoryService.getMemoryStats();
            const categories = await this.memoryService.getCategories();
            
            const totalMemories = Object.values(stats).reduce((sum, count) => sum + count, 0);
            
            const statsText = Object.entries(stats)
              .map(([category, count]) => `${category}: ${count}`)
              .join('\n');

            return {
              content: [{
                type: 'text',
                text: `Memory Statistics:\n\nTotal Memories: ${totalMemories}\nCategories: ${categories.length}\n\nBreakdown by Category:\n${statsText}\n\nAvailable Categories: ${categories.join(', ')}`
              }]
            };
          }

          case 'semantic_search_memory': {
            try {
              const results = await this.memoryService.semanticSearch(args.query as string, {
                limit: (args.limit as number) || 5,
                minSimilarity: (args.min_similarity as number) || 0.7,
                category: args.category as string | undefined
              });

              if (results.length === 0) {
                return {
                  content: [{
                    type: 'text',
                    text: `No semantically similar memories found for query: "${args.query}"`
                  }]
                };
              }

              const formattedResults = results.map((result: any) => 
                `ID: ${result.memory.id}\nContent: ${result.memory.content}\nCategory: ${result.memory.category}\nSimilarity: ${result.similarity.toFixed(3)}\nUpdated: ${new Date(result.memory.updated_at).toISOString()}`
              ).join('\n\n---\n\n');

              return {
                content: [{
                  type: 'text',
                  text: `Found ${results.length} semantically similar memories:\n\n${formattedResults}`
                }]
              };
            } catch (error) {
              return {
                content: [{
                  type: 'text',
                  text: `Semantic search failed: ${(error as Error).message}`
                }],
                isError: true
              };
            }
          }

          case 'hybrid_search_memory': {
            try {
              const results = await this.memoryService.hybridSearch(args.query as string, {
                limit: (args.limit as number) || 10,
                category: args.category as string | undefined,
                textWeight: (args.text_weight as number) || 0.3,
                semanticWeight: (args.semantic_weight as number) || 0.7
              });

              if (results.length === 0) {
                return {
                  content: [{
                    type: 'text',
                    text: `No matching memories found for hybrid search: "${args.query}"`
                  }]
                };
              }

              const formattedResults = results.map((result: any) => 
                `ID: ${result.memory.id}\nContent: ${result.memory.content}\nCategory: ${result.memory.category}\nCombined Score: ${result.combinedScore.toFixed(3)}\nSemantic: ${result.similarity.toFixed(3)} | Text: ${(result.textScore || 0).toFixed(3)}\nUpdated: ${new Date(result.memory.updated_at).toISOString()}`
              ).join('\n\n---\n\n');

              return {
                content: [{
                  type: 'text',
                  text: `Found ${results.length} matching memories (hybrid search):\n\n${formattedResults}`
                }]
              };
            } catch (error) {
              return {
                content: [{
                  type: 'text',
                  text: `Hybrid search failed: ${(error as Error).message}`
                }],
                isError: true
              };
            }
          }

          case 'find_similar_memories': {
            try {
              const results = await this.memoryService.findSimilarMemories(args.memory_id as string, {
                limit: (args.limit as number) || 5,
                minSimilarity: (args.min_similarity as number) || 0.7,
                category: args.category as string | undefined
              });

              if (results.length === 0) {
                return {
                  content: [{
                    type: 'text',
                    text: `No similar memories found for memory ID: ${args.memory_id}`
                  }]
                };
              }

              const formattedResults = results.map((result: any) => 
                `ID: ${result.memory.id}\nContent: ${result.memory.content}\nCategory: ${result.memory.category}\nSimilarity: ${result.similarity.toFixed(3)}\nUpdated: ${new Date(result.memory.updated_at).toISOString()}`
              ).join('\n\n---\n\n');

              return {
                content: [{
                  type: 'text',
                  text: `Found ${results.length} similar memories:\n\n${formattedResults}`
                }]
              };
            } catch (error) {
              return {
                content: [{
                  type: 'text',
                  text: `Finding similar memories failed: ${(error as Error).message}`
                }],
                isError: true
              };
            }
          }

          case 'get_embedding_stats': {
            try {
              const isEnabled = this.memoryService.isSemanticSearchEnabled();
              const providerInfo = this.memoryService.getEmbeddingProviderInfo();
              const embeddingStats = await this.memoryService.getEmbeddingStatistics();

              let statsText = `Semantic Search: ${isEnabled ? 'Enabled' : 'Disabled'}\n\n`;

              if (providerInfo) {
                statsText += `Provider: ${providerInfo.name}\nDimensions: ${providerInfo.dimensions}\n\n`;
              }

              if (embeddingStats) {
                statsText += `Total Embeddings: ${embeddingStats.totalEmbeddings}\n\n`;
                
                if (Object.keys(embeddingStats.providerStats).length > 0) {
                  statsText += 'Provider Statistics:\n';
                  Object.entries(embeddingStats.providerStats).forEach(([provider, stats]) => {
                    statsText += `${provider}: ${stats.count} embeddings, models: ${stats.models.join(', ')}\n`;
                  });
                }
              } else {
                statsText += 'No embedding statistics available (semantic search disabled)';
              }

              return {
                content: [{
                  type: 'text',
                  text: statsText
                }]
              };
            } catch (error) {
              return {
                content: [{
                  type: 'text',
                  text: `Failed to get embedding statistics: ${(error as Error).message}`
                }],
                isError: true
              };
            }
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error executing tool "${name}": ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    });
  }

  private setupErrorHandling() {
    this.server.onerror = (error) => {
      console.error('[MCP Error]', error);
    };

    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  private async cleanup() {
    this.memoryService.close();
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Claude Memory Server running on stdio');
  }
}

// Start the server
const server = new MemoryServer();
server.run().catch(console.error);