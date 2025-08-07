# Claude Memory Server

An MCP (Model Context Protocol) server that provides long-term memory capabilities for Claude, allowing persistent storage and retrieval of context across conversations.

## Features

- **Persistent Memory Storage**: Store important context, facts, and preferences
- **Full-Text Search**: Search through memories using natural language queries
- **Organized Categories**: Categorize memories for better organization
- **CRUD Operations**: Create, read, update, and delete memory entries
- **SQLite Database**: Fast, reliable local storage with FTS5 search capabilities

## Memory Categories

- `facts` - Important facts and information
- `preferences` - User preferences and settings
- `conversations` - Conversation context and history  
- `projects` - Project-related information
- `learning` - Things learned during interactions
- `goals` - User goals and objectives
- `context` - General context information
- `reminders` - Things to remember

## Available Tools

1. **store_memory** - Store a new memory entry
2. **search_memory** - Search memories using full-text search
3. **get_memory** - Retrieve a specific memory by ID
4. **update_memory** - Update an existing memory
5. **delete_memory** - Delete a memory by ID
6. **list_memories** - List memories by category or recent
7. **get_memory_stats** - Get memory statistics and categories

## Installation

1. Clone or download this project
2. Install dependencies:
   ```bash
   bun install
   ```
3. Build the project:
   ```bash
   bun run build
   ```

## Configuration

### Claude Desktop Integration

To integrate with Claude Desktop, you need to update your Claude Desktop configuration:

1. **Find your Claude Desktop config directory:**
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%/Claude/claude_desktop_config.json`

2. **Add the memory server configuration:**
   ```json
   {
     "mcpServers": {
       "claude-memory": {
         "command": "node",
         "args": ["/path/to/claude-memory-server/dist/index.js"],
         "env": {}
       }
     }
   }
   ```

3. **Update the path** in the `args` array to point to your actual installation directory.

4. **Restart Claude Desktop** for the changes to take effect.

### Manual Testing

You can also run the server directly for testing:

```bash
# Development mode
bun run dev

# Production mode
bun run start
```

The server uses stdio transport and will communicate via standard input/output.

## Usage Examples

Once integrated with Claude Desktop, you can use the memory tools in your conversations:

### Storing Memories
```
Please store this as a memory: I prefer using TypeScript over JavaScript for all projects.
Category: preferences
```

### Searching Memories  
```
Search my memories for anything about TypeScript preferences.
```

### Getting Statistics
```
Show me my memory statistics - how many memories I have by category.
```

## Database

The server uses SQLite for storage with the following features:

- **FTS5 Full-Text Search** for natural language queries
- **Automatic indexing** on categories, dates, and relevance scores
- **JSON metadata** storage for flexible data
- **Triggers** to keep search index synchronized

The database file (`memory.db`) will be created in the project directory on first run.

## Development

### Project Structure
```
src/
├── index.ts          # Main MCP server implementation
├── memory-service.ts # Memory business logic
└── database.ts       # SQLite database operations
```

### Scripts
- `bun run build` - Build TypeScript to JavaScript
- `bun run start` - Start the compiled server
- `bun run dev` - Development mode with file watching

## Future Enhancements

- **Vector Embeddings**: Semantic search using OpenAI embeddings
- **Memory Expiration**: Automatic cleanup of old memories
- **Export/Import**: Backup and restore memory data
- **Memory Relationships**: Link related memories together
- **HTTP Transport**: Web-based interface for memory management

## License

ISC License