# Knowledge Graph Memory Server

An advanced, dual-backend implementation of persistent memory. This server lets an AI assistant remember information about users and concepts across chats, using either a simple JSONL file or a powerful Neo4j graph database.

## Architecture

This server now supports two backend data stores for the knowledge graph:

1.  **File-based (default)**: A simple, human-readable JSONL file (`memory.json`). This is the default mode and requires no setup.
2.  **Neo4j**: A high-performance, scalable graph database that enables advanced search capabilities like semantic and graph traversal queries.

The backend is chosen at startup based on the `MEMORY_BACKEND` environment variable.

## Configuration

The server is configured via environment variables.

### Basic Configuration

-   `MEMORY_BACKEND`: Determines the data store.
    -   `file` (or unset): Use the JSONL file backend.
    -   `neo4j`: Use the Neo4j database backend.
-   `MEMORY_FILE_PATH`: (File backend only) Path to the memory storage JSON file. Defaults to `memory.json` in the server's execution directory.

### Neo4j Configuration

These variables are **required** if `MEMORY_BACKEND=neo4j`:

-   `NEO4J_URI`: The connection URI for the Neo4j instance (e.g., `neo4j://localhost:7687`).
-   `NEO4J_USER`: The username for the Neo4j database.
-   `NEO4J_PASSWORD`: The password for the Neo4j database.

> **Note on Neo4j Setup**: When first connecting to the database, the server will automatically create a uniqueness constraint on entity names and a vector index for observations.

---

## API

All tools from the original API are preserved. The `search_nodes` tool has been significantly upgraded.

- **create_entities**: Creates new entities.
- **create_relations**: Creates new relations.
- **add_observations**: Adds observations to entities.
- **delete_entities**: Deletes entities.
- **delete_observations**: Deletes observations.
- **delete_relations**: Deletes relations.
- **read_graph**: Reads the entire graph.
- **open_nodes**: Retrieves specific nodes by name.

### `search_nodes` (Advanced)

This tool now accepts a single `query` object that specifies the search strategy and its parameters.

**Input**: `{ query: AdvancedSearchQuery }`

#### 1. Keyword Search

Performs a simple, case-insensitive text search across entity names, types, and observations.

-   **Backend**: File, Neo4j
-   **Query Object**: `{ "type": "keyword", "query": "your search term" }`

#### 2. Cypher Search

<br>

> **⚠️ Security Warning:** This query type is extremely powerful and intended for trusted users or internal development only. It allows the execution of arbitrary (read-only) Cypher queries. Exposing this to untrusted users can lead to data exposure and Denial of Service (DoS) attacks through resource-intensive queries. Use with extreme caution.

<br>

Directly execute a read-only Cypher query against the Neo4j database.

-   **Backend**: Neo4j only
-   **Query Object**: `{ "type": "cypher", "query": "MATCH (p:Person)-[:WORKS_AT]->(o:Organization) WHERE o.name CONTAINS 'Anthropic' RETURN p" }`

#### 3. Semantic (Vector) Search

Finds entities based on the semantic meaning of their observations, not just keywords.

-   **Backend**: Neo4j only
-   **How it works**: When observations are added, they are converted into a vector embedding. This search finds entities whose observation vectors are most similar to the vector of the query text.
-   **Query Object**: `{ "type": "semantic", "text": "Who has experience in software development?", "topK": 3 }`

#### 4. Traversal Search

Performs a graph traversal starting from a specific node, following a defined pattern.

-   **Backend**: Neo4j only
-   **Query Object**: Find John's colleagues (people who work at the same organization).
    ```json
    {
      "type": "traversal",
      "startNode": "John_Smith",
      "hops": [
        {"type": "WORKS_AT", "direction": "out"},
        {"type": "WORKS_AT", "direction": "in"}
      ],
      "endLabel": "Person"
    }
    ```
- **Hybrid Search**: A planned feature to combine multiple query types. Not yet implemented in the current version.

---

## Setup and Usage

### Using the File Backend (Default)

If you just want to run the server without a database, no special configuration is needed.

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    }
  }
}
```

### Using the Neo4j Backend

1.  **Run Neo4j**: You must have a running Neo4j database.
2.  **Set Environment Variables**: Configure the server with your database credentials.

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"],
      "env": {
        "MEMORY_BACKEND": "neo4j",
        "NEO4J_URI": "neo4j://localhost:7687",
        "NEO4J_USER": "neo4j",
        "NEO4J_PASSWORD": "your_password"
      }
    }
  }
}
```

## Building

Docker:

```sh
docker build -t mcp/memory -f src/memory/Dockerfile .
```

## Dependencies

This server now includes two important dependencies:
- `neo4j-driver`: The official Neo4j driver for Node.js.
- `@xenova/transformers`: A powerful library used to generate the vector embeddings for semantic search, running entirely locally.

## License

This MCP server is licensed under the MIT License.
