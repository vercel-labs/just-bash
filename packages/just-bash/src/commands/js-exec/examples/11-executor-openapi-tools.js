/**
 * Example: Native @executor-js/sdk integration via the Bash constructor
 *
 * The SDK discovers tools from OpenAPI, GraphQL, and MCP sources.
 * js-exec runs user code in a QuickJS sandbox — tool calls are bridged
 * back to the SDK, which handles HTTP, auth, and schema validation.
 *
 * Requires: @executor-js/sdk and effect as dependencies.
 */

// @ts-check — this is a JS file with JSDoc types for illustration

import { Bash } from "just-bash";

const bash = new Bash({
  experimental_executor: {
    // Inline tools work alongside SDK-discovered tools
    tools: {
      "util.timestamp": {
        description: "Get the current Unix timestamp",
        execute: () => ({ ts: Math.floor(Date.now() / 1000) }),
      },
    },

    // Async setup receives the @executor-js/sdk instance.
    // Add OpenAPI, GraphQL, or MCP sources here.
    setup: async (sdk) => {
      // OpenAPI: discovers all operations from the spec
      await sdk.sources.add({
        kind: "openapi",
        endpoint: "https://petstore3.swagger.io/api/v3",
        specUrl: "https://petstore3.swagger.io/api/v3/openapi.json",
        name: "petstore",
      });

      // GraphQL: introspects the schema for queries/mutations
      await sdk.sources.add({
        kind: "graphql",
        endpoint: "https://countries.trevorblades.com/graphql",
        name: "countries",
      });

      // MCP: connects to a Model Context Protocol server
      await sdk.sources.add({
        kind: "mcp",
        endpoint: "https://mcp.example.com/sse",
        name: "internal",
        transport: "sse",
      });
    },
  },
});

// All tools — inline + SDK-discovered — are available as tools.*
const result = await bash.exec(`js-exec -c '
  // Inline tool
  const now = await tools.util.timestamp();
  console.log("Timestamp:", now.ts);

  // OpenAPI-discovered tool (from petstore spec)
  const pets = await tools.petstore.findPetsByStatus({ status: "available" });
  console.log("Available pets:", pets.length);

  // GraphQL-discovered tool (from introspection)
  const country = await tools.countries.country({ code: "US" });
  console.log("Country:", country.name);

  // MCP-discovered tool (from server capabilities)
  const docs = await tools.internal.searchDocs({ query: "deployment" });
  console.log("Docs found:", docs.hits.length);
'`);

console.log(result.stdout);
