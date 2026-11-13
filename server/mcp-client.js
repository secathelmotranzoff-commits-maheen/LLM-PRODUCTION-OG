import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
let connection, connectedClient;
export async function getMcp() {
  if (!connection) connection = (async () => {
    const client = new Client({ name: 'relay-host', version: '0.1.0' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./mcp-server.js', import.meta.url))], env: { PATH: process.env.PATH || '', ...(process.env.RELAY_WORKSPACE ? { RELAY_WORKSPACE: process.env.RELAY_WORKSPACE } : {}) }, stderr: 'ignore' });
    client.onclose = () => { if (connectedClient === client) { connectedClient = null; connection = null; } };
    try { await client.connect(transport); connectedClient = client; return client; } catch (error) { await transport.close(); throw error; }
  })().catch(error => { connection = null; throw error; });
  return connection;
}
export async function closeMcp() { if (connection) { const client = await connection.catch(() => null); connection = null; connectedClient = null; await client?.close(); } }
