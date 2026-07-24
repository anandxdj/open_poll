import axios from 'axios';

const BASE_URL = 'http://localhost:5000/mcp';
const TOKEN = process.env.MCP_TOKEN || 'your_mcp_token_here';

function parseSseResponse(data: unknown): any {
  if (typeof data !== 'string') {
    return data;
  }
  const lines = data.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try {
        return JSON.parse(line.substring(6));
      } catch (e) {
        console.error('Failed to parse data line as JSON:', line, e);
      }
    }
  }
  return null;
}

async function sendMcpRequest(url: string, body: any, headers: any) {
  const response = await axios.post(url, body, {
    headers,
    responseType: 'text'
  });

  const rawText = response.data;
  const parsed = parseSseResponse(rawText);
  return {
    headers: response.headers,
    rawText,
    parsed
  };
}

async function runTest() {
  console.log('=== Starting MCP End-to-End Test ===');
  
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream'
  };

  // 1. Initialize
  console.log('\n--- 1. Initializing MCP Session ---');
  const initResult = await sendMcpRequest(BASE_URL, {
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'test-client',
        version: '1.0.0'
      }
    },
    id: 1
  }, headers);

  const sessionId = initResult.headers['mcp-session-id'];
  console.log('Session ID from header:', sessionId);
  console.log('Initialize response (parsed):', JSON.stringify(initResult.parsed, null, 2));

  if (!sessionId) {
    throw new Error('No session ID returned in headers!');
  }

  // Include the session ID in subsequent headers
  const sessionHeaders = {
    ...headers,
    'mcp-session-id': sessionId
  };

  // 2. List tools
  console.log('\n--- 2. Listing Tools ---');
  const toolsResult = await sendMcpRequest(BASE_URL, {
    jsonrpc: '2.0',
    method: 'tools/list',
    params: {},
    id: 2
  }, sessionHeaders);

  console.log('Tools response (parsed):', JSON.stringify(toolsResult.parsed, null, 2));

  // 3. List existing polls
  console.log('\n--- 3. Listing Existing Polls ---');
  const listPollsResult = await sendMcpRequest(BASE_URL, {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'list_polls',
      arguments: {}
    },
    id: 3
  }, sessionHeaders);

  console.log('List polls result (parsed):', JSON.stringify(listPollsResult.parsed, null, 2));

  // 4. Create a new poll
  console.log('\n--- 4. Creating a New Poll ---');
  const createPollResult = await sendMcpRequest(BASE_URL, {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'create_poll',
      arguments: {
        title: `Street Food Debate ${Date.now()}`,
        isAnonymous: false,
        questions: [
          {
            text: 'What is the absolute best street food?',
            options: ['Tacos', 'Ramen', 'Samosa', 'Hotdog']
          }
        ]
      }
    },
    id: 4
  }, sessionHeaders);

  console.log('Create poll result (parsed):', JSON.stringify(createPollResult.parsed, null, 2));
  
  // Extract poll ID
  const poll = createPollResult.parsed?.result?.content?.[0]?.text 
    ? JSON.parse(createPollResult.parsed.result.content[0].text).poll
    : null;

  if (!poll || !poll._id) {
    console.error('Failed to parse poll ID from response:', createPollResult.parsed);
    return;
  }
  const pollId = poll._id;
  console.log('Created Poll ID:', pollId);

  // 5. Get share link
  console.log('\n--- 5. Getting Share Link ---');
  const shareLinkResult = await sendMcpRequest(BASE_URL, {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'get_share_link',
      arguments: {
        pollId
      }
    },
    id: 5
  }, sessionHeaders);

  console.log('Share link response (parsed):', JSON.stringify(shareLinkResult.parsed, null, 2));

  // 6. Get poll analytics
  console.log('\n--- 6. Getting Poll Analytics ---');
  const analyticsResult = await sendMcpRequest(BASE_URL, {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'get_poll_analytics',
      arguments: {
        pollId
      }
    },
    id: 6
  }, sessionHeaders);

  console.log('Analytics response (parsed):', JSON.stringify(analyticsResult.parsed, null, 2));

  console.log('\n=== MCP End-to-End Test Complete ===');
}

runTest().catch((err) => {
  console.error('Test failed with error:', err.response?.data || err.message || err);
});
